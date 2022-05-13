import { Services } from "../client.ts";
import { Options } from "../client-options.ts";
import { RPC_ACTION, RPCMessage, RPCResult, TOPIC } from "../constants.ts";

export class RPCResponse {
  #services: Services;
  #name: string;
  #correlationId: string;
  #isAccepted: boolean;
  #isComplete: boolean;
  autoAccept: boolean;

  constructor(message: RPCMessage, _options: Options, services: Services) {
    this.#name = message.name as string;
    this.#correlationId = message.correlationId as string;
    this.#services = services;
    this.#isAccepted = false;
    this.#isComplete = false;
    this.autoAccept = true;
    this.#services.timerRegistry.requestIdleCallback(
      this.#performAutoAck.bind(this),
    );
  }

  accept() {
    if (this.#isAccepted === false) {
      this.#services.connection.sendMessage({
        topic: TOPIC.RPC,
        action: RPC_ACTION.ACCEPT,
        name: this.#name,
        correlationId: this.#correlationId,
      });
      this.#isAccepted = true;
    }
  }

  reject(): void {
    if (this.#isComplete === true) {
      throw new Error(`Rpc ${this.#name} already completed`);
    }
    this.autoAccept = false;
    this.#isComplete = true;
    this.#isAccepted = true;
    this.#services.connection.sendMessage({
      topic: TOPIC.RPC,
      action: RPC_ACTION.REJECT,
      name: this.#name,
      correlationId: this.#correlationId,
    });
  }

  error(error: RPCResult): void {
    if (this.#isComplete === true) {
      throw new Error(`Rpc ${this.#name} already completed`);
    }
    this.autoAccept = false;
    this.#isComplete = true;
    this.#isAccepted = true;
    this.#services.connection.sendMessage({
      topic: TOPIC.RPC,
      action: RPC_ACTION.REQUEST_ERROR,
      name: this.#name,
      correlationId: this.#correlationId,
      parsedData: error,
    });
  }

  send(data: RPCResult): void {
    if (this.#isComplete === true) {
      throw new Error(`Rpc ${this.#name} already completed`);
    }
    this.accept();

    this.#services.connection.sendMessage({
      topic: TOPIC.RPC,
      action: RPC_ACTION.RESPONSE,
      name: this.#name,
      correlationId: this.#correlationId,
      parsedData: data,
    });
    this.#isComplete = true;
  }

  #performAutoAck(): void {
    if (this.autoAccept === true) {
      this.accept();
    }
  }
}
