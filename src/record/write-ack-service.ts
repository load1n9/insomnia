// deno-lint-ignore-file ban-types

import { EVENT, Message, RECORD_ACTION } from "../constants.ts";
import { Services } from "../client.ts";
import { WriteAckCallback } from "./record-core.ts";

export class WriteAcknowledgementService {
  #services: Services;
  #responses: Map<string, Function>;
  #count: number;

  constructor(services: Services) {
    this.#services = services;
    this.#responses = new Map<string, WriteAckCallback>();
    this.#count = 1;

    this.#services.connection.onLost(this.#onConnectionLost.bind(this));
  }

  send(message: Message, callback: WriteAckCallback): void {
    if (this.#services.connection.isConnected === false) {
      this.#services.timerRegistry.requestIdleCallback(
        callback.bind(this, EVENT.CLIENT_OFFLINE, message.name!),
      );
      return;
    }
    const correlationId = this.#count.toString();
    this.#responses.set(correlationId, callback);
    this.#services.connection.sendMessage({
      ...message,
      correlationId,
      isWriteAck: true,
    });
    this.#count++;
  }

  recieve(message: Message): void {
    const id = message.correlationId as string;
    const response = this.#responses.get(id);
    if (
      !response ||
      (message.action !== RECORD_ACTION.WRITE_ACKNOWLEDGEMENT &&
        !message.isError && !message.isWriteAck)
    ) {
      return;
    }

    if (message.action === RECORD_ACTION.VERSION_EXISTS) {
      response(message.reason || "Write failed due to conflict", message.name!);
    } else {
      message.isError
        ? response(
          RECORD_ACTION[message.action as RECORD_ACTION],
          message.name!,
        )
        : response(null, message.name!);
    }

    this.#responses.delete(id);
  }

  #onConnectionLost(): void {
    this.#responses.forEach((response) => response(EVENT.CLIENT_OFFLINE));
    this.#responses.clear();
  }
}
