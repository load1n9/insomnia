// deno-lint-ignore-file no-explicit-any

import { EVENT, Message, RECORD_ACTION, TOPIC } from "../constants.ts";
import { Services } from "../client.ts";

export class SingleNotifier<MessageType extends Message> {
  #requests = new Map<
    string,
    Array<(error?: any, result?: any) => void>
  >();
  #internalRequests = new Map<
    string,
    Array<{ context: any; callback: (message: MessageType) => void }>
  >();
  #limboQueue: Message[] = [];
  #services: Services;
  #action: RECORD_ACTION.READ | RECORD_ACTION.HEAD;
  constructor(
    services: Services,
    action: RECORD_ACTION.READ | RECORD_ACTION.HEAD,
    _timeoutDuration: number,
  ) {
    this.#services = services;
    this.#action = action;
    this.#services.connection.onLost(this.#onConnectionLost.bind(this));
    this.#services.connection.onExitLimbo(this.#onExitLimbo.bind(this));
    this.#services.connection.onReestablished(
      this.#onConnectionReestablished.bind(this),
    );
  }

  request(name: string, callback: (error?: any, result?: any) => void): void {
    const req = this.#requests.get(name);
    if (req) {
      req.push(callback);
      return;
    }

    this.#requests.set(name, [callback]);

    const message = {
      topic: TOPIC.RECORD,
      action: this.#action,
      name,
    };

    if (this.#services.connection.isConnected) {
      this.#services.connection.sendMessage(message);
      this.#services.timeoutRegistry.add({ message });
    } else if (this.#services.connection.isInLimbo) {
      this.#limboQueue.push(message);
    } else {
      this.#requests.delete(name);
      callback(EVENT.CLIENT_OFFLINE);
    }
  }

  register(
    name: string,
    context: any,
    callback: (message: MessageType) => void,
  ): void {
    const request = this.#internalRequests.get(name);
    if (!request) {
      this.#internalRequests.set(name, [{ callback, context }]);
    } else {
      request.push({ callback, context });
    }
  }

  recieve(message: MessageType, error?: any, data?: any): void {
    this.#services.timeoutRegistry.remove(message);
    const name = message.name!;
    const responses = this.#requests.get(name) || [];
    const internalResponses = this.#internalRequests.get(name) || [];
    if (!responses && !internalResponses) {
      return;
    }

    for (let i = 0; i < internalResponses.length; i++) {
      internalResponses[i].callback.call(internalResponses[i].context, message);
    }
    this.#internalRequests.delete(name);

    for (let i = 0; i < responses.length; i++) {
      responses[i](error, data);
    }
    this.#requests.delete(name);
    return;
  }

  #onConnectionLost(): void {
    this.#requests.forEach((responses) => {
      responses.forEach((response) => response(EVENT.CLIENT_OFFLINE));
    });
    this.#requests.clear();
  }

  #onExitLimbo(): void {
    for (let i = 0; i < this.#limboQueue.length; i++) {
      const message = this.#limboQueue[i];
      const requests = this.#requests.get(message.name as string);
      if (requests) {
        requests.forEach((cb) => cb(EVENT.CLIENT_OFFLINE));
      }
    }
    this.#requests.clear();
    this.#limboQueue = [];
  }

  #onConnectionReestablished(): void {
    for (let i = 0; i < this.#limboQueue.length; i++) {
      const message = this.#limboQueue[i];
      this.#services.connection.sendMessage(message);
      this.#services.timeoutRegistry.add({ message });
    }
  }
}
