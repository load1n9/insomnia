import { Services } from "../client.ts";
import { Options } from "../client-options.ts";
import { EVENT, RESPONSE_TO_REQUEST } from "../constants.ts";

import { Emitter } from "../util/emitter.ts";
import { RECORD_ACTION, RPC_ACTION } from "../../types/all.ts";
import { Message } from "../../types/messages.ts";

export type TimeoutId = string | null;
export type TimeoutAction = EVENT | RPC_ACTION | RECORD_ACTION;

export interface Timeout {
  event?: TimeoutAction;
  message: Message;
  callback?: (event: TimeoutAction, message: Message) => void;
  duration?: number;
}

interface InternalTimeout {
  timerId: number;
  uniqueName: string;
  timeout: Timeout;
}

export class TimeoutRegistry extends Emitter {
  #register: Map<string, InternalTimeout> = new Map();
  #services: Services;
  #options: Options;
  constructor(services: Services, options: Options) {
    super();
    this.#services = services;
    this.#options = options;
  }

  add(timeout: Timeout): TimeoutId {
    if (timeout.duration === undefined) {
      timeout.duration = this.#options.subscriptionTimeout;
    }

    if (timeout.event === undefined) {
      timeout.event = EVENT.ACK_TIMEOUT;
    }

    if (!this.#services.connection.isConnected) {
      return null;
    }

    this.remove(timeout.message);

    const internalTimeout: InternalTimeout = {
      timerId: -1,
      uniqueName: this.#getUniqueName(timeout.message)!,
      timeout,
    };

    internalTimeout.timerId = this.#services.timerRegistry.add({
      context: this,
      callback: this.#onTimeout,
      duration: timeout.duration!,
      data: internalTimeout,
    });
    this.#register.set(internalTimeout.uniqueName, internalTimeout);
    return internalTimeout.uniqueName;
  }

  remove(message: Message): void {
    const action = RESPONSE_TO_REQUEST[message.topic][message.action];
    const requestMsg = !action ? message : { ...message, action };
    const uniqueName = this.#getUniqueName(requestMsg);
    this.clear(uniqueName);
  }

  clear(uniqueName: TimeoutId): void {
    const timeout = this.#register.get(uniqueName!);
    if (timeout) {
      this.#register.delete(uniqueName!);
      this.#services.timerRegistry.remove(timeout.timerId);
    }
  }

  #onTimeout(internalTimeout: InternalTimeout): void {
    this.#register.delete(internalTimeout.uniqueName);
    const timeout = internalTimeout.timeout;
    if (timeout.callback) {
      timeout.callback(timeout.event as EVENT, timeout.message);
    } else {
      this.#services.logger.warn(timeout.message, timeout.event);
    }
  }

  #getUniqueName(message: Message): TimeoutId {
    const action = message.originalAction || message.action;

    let name = `${message.topic}${action}_`;
    if (message.correlationId) {
      name += message.correlationId;
    } else if (message.name) {
      name += message.name;
    }
    return name;
  }

  onConnectionLost(): void {
    for (const [uniqueName, timeout] of this.#register) {
      this.#services.timerRegistry.remove(timeout.timerId);
      this.#register.delete(uniqueName);
    }
  }
}
