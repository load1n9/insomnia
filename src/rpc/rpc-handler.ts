// deno-lint-ignore-file no-explicit-any
import { Services } from "../client.ts";
import { Options } from "../client-options.ts";
import {
  EVENT,
  Message,
  RPC_ACTION,
  RPCMessage,
  RPCResult,
  TOPIC,
} from "../constants.ts";
import { RPC, RPCMakeCallback } from "../rpc/rpc.ts";
import { RPCResponse } from "../rpc/rpc-response.ts";
import { getUid } from "../util/utils.ts";
import { BulkSubscriptionService } from "../util/bulk-subscription-service.ts";

export type RPCProvider = (rpcData: any, response: RPCResponse) => void;

export class RPCHandler {
  #rpcs = new Map<string, RPC>();
  #providers = new Map<string, RPCProvider>();
  #limboQueue: Array<
    {
      name: string;
      data: any;
      correlationId: string;
      callback: RPCMakeCallback;
    }
  > = [];
  #bulkSubscription: BulkSubscriptionService<RPC_ACTION>;
  #services: Services;
  #options: Options;

  constructor(services: Services, options: Options) {
    this.#services = services;
    this.#options = options;
    this.#bulkSubscription = new BulkSubscriptionService<RPC_ACTION>(
      this.#services,
      options.subscriptionInterval,
      TOPIC.RPC,
      RPC_ACTION.PROVIDE,
      RPC_ACTION.UNPROVIDE,
      this.#onBulkSubscriptionSent.bind(this),
    );

    this.#services.connection.registerHandler(
      TOPIC.RPC,
      this.#handle.bind(this),
    );
    this.#services.connection.onReestablished(
      this.#onConnectionReestablished.bind(this),
    );
    this.#services.connection.onExitLimbo(this.#onExitLimbo.bind(this));
    this.#services.connection.onLost(this.#onConnectionLost.bind(this));
  }

  providerNames(): string[] {
    return [...this.#providers.keys()];
  }

  provide(name: string, callback: RPCProvider): void {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }
    if (this.#providers.has(name)) {
      throw new Error(`RPC ${name} already registered`);
    }
    if (typeof callback !== "function") {
      throw new Error("invalid argument callback");
    }

    this.#providers.set(name, callback);
    if (this.#services.connection.isConnected) {
      this.#bulkSubscription.subscribe(name);
    }
  }

  unprovide(name: string) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }

    if (!this.#providers.has(name)) {
      this.#services.logger.warn({
        topic: TOPIC.RPC,
        action: RPC_ACTION.NOT_PROVIDED,
        name,
      });
      return;
    }

    this.#providers.delete(name);
    if (this.#services.connection.isConnected) {
      this.#bulkSubscription.unsubscribe(name);
    }
  }

  make(name: string, data: any): Promise<any>;
  make(name: string, data: any, callback: RPCMakeCallback): void;
  make(
    name: string,
    data: any,
    callback?: RPCMakeCallback,
  ): Promise<any> | void {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }
    if (callback && typeof callback !== "function") {
      throw new Error("invalid argument callback");
    }

    const correlationId = getUid();

    if (this.#services.connection.isConnected) {
      if (callback) {
        this.#rpcs.set(
          correlationId,
          new RPC(
            name,
            correlationId,
            data,
            callback,
            this.#options,
            this.#services,
          ),
        );
        return;
      }

      return new Promise((resolve, reject) => {
        this.#rpcs.set(
          correlationId,
          new RPC(
            name,
            correlationId,
            data,
            (error: string | null, result: any) =>
              error ? reject(error) : resolve(result),
            this.#options,
            this.#services,
          ),
        );
      });
    } else if (this.#services.connection.isInLimbo) {
      if (callback) {
        this.#limboQueue.push({ correlationId, name, data, callback });
      } else {
        return new Promise((resolve, reject) => {
          this.#limboQueue.push({
            correlationId,
            name,
            data,
            callback: (error: string | null, result?: RPCResult) =>
              error ? reject(error) : resolve(result),
          });
        });
      }
    } else {
      if (callback) {
        callback(EVENT.CLIENT_OFFLINE);
      } else {
        return Promise.reject(EVENT.CLIENT_OFFLINE);
      }
    }
  }

  #respondToRpc(message: RPCMessage) {
    const provider = this.#providers.get(message.name);
    if (provider) {
      provider(
        message.parsedData,
        new RPCResponse(message, this.#options, this.#services),
      );
    } else {
      this.#services.connection.sendMessage({
        topic: TOPIC.RPC,
        action: RPC_ACTION.REJECT,
        name: message.name,
        correlationId: message.correlationId,
      });
    }
  }

  #handle(message: RPCMessage): void {
    if (message.action === RPC_ACTION.REQUEST) {
      this.#respondToRpc(message);
      return;
    }

    if (message.isAck) {
      this.#services.timeoutRegistry.remove(message);
      return;
    }

    if (
      message.action === RPC_ACTION.MESSAGE_PERMISSION_ERROR ||
      message.action === RPC_ACTION.MESSAGE_DENIED
    ) {
      if (
        message.originalAction === RPC_ACTION.PROVIDE ||
        message.originalAction === RPC_ACTION.UNPROVIDE
      ) {
        this.#services.timeoutRegistry.remove(message);
        this.#providers.delete(message.name);
        this.#services.logger.error(message);
        return;
      }
      if (message.originalAction === RPC_ACTION.REQUEST) {
        const invalidRPC = this.#getRPC(message);
        if (invalidRPC) {
          invalidRPC.error(RPC_ACTION[message.action]);
          this.#rpcs.delete(message.correlationId);
          return;
        }
      }
    }

    const rpc = this.#getRPC(message);
    if (rpc) {
      if (message.action === RPC_ACTION.ACCEPT) {
        rpc.accept();
        return;
      }

      if (message.action === RPC_ACTION.RESPONSE) {
        rpc.respond(message.parsedData);
      } else if (message.action === RPC_ACTION.REQUEST_ERROR) {
        rpc.error(message.parsedData);
      } else if (
        message.action === RPC_ACTION.RESPONSE_TIMEOUT ||
        message.action === RPC_ACTION.ACCEPT_TIMEOUT ||
        message.action === RPC_ACTION.NO_RPC_PROVIDER
      ) {
        rpc.error(RPC_ACTION[message.action]);
      }
      this.#rpcs.delete(message.correlationId as string);
    }
  }

  #getRPC(message: RPCMessage): RPC | undefined {
    const rpc = this.#rpcs.get(message.correlationId as string);
    if (rpc === undefined) {
      this.#services.logger.error(message, EVENT.UNKNOWN_CORRELATION_ID);
    }
    return rpc;
  }

  #onConnectionReestablished(): void {
    this.#bulkSubscription.subscribeList([...this.#providers.keys()]);
    for (let i = 0; i < this.#limboQueue.length; i++) {
      const { correlationId, name, data, callback } = this.#limboQueue[i];
      this.#rpcs.set(
        correlationId,
        new RPC(
          name,
          correlationId,
          data,
          callback,
          this.#options,
          this.#services,
        ),
      );
    }
    this.#limboQueue = [];
  }

  #onExitLimbo() {
    for (let i = 0; i < this.#limboQueue.length; i++) {
      this.#limboQueue[i].callback(EVENT.CLIENT_OFFLINE);
    }
    this.#limboQueue = [];
  }

  #onConnectionLost(): void {
    this.#rpcs.forEach((rpc) => {
      rpc.error(EVENT.CLIENT_OFFLINE);
    });
    this.#rpcs.clear();
  }

  #onBulkSubscriptionSent(message: Message): void {
    this.#services.timeoutRegistry.add({ message });
  }
}
