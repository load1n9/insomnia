import { EVENT } from "../constants.ts";
import { ACTIONS, ALL_ACTIONS, Message } from "../../types/messages.ts";
import { JSONObject, TOPIC } from "../../types/all.ts";
import { Emitter } from "./emitter.ts";

// deno-lint-ignore no-explicit-any
function isEvent(action: any): boolean {
  // deno-lint-ignore no-explicit-any
  return (EVENT as any)[action] !== undefined;
}

export class Logger {
  #emitter: Emitter;
  constructor(emitter: Emitter) {
    this.#emitter = emitter;
  }

  warn(
    message: { topic: TOPIC } | Message,
    event?: EVENT | ALL_ACTIONS,
    // deno-lint-ignore no-explicit-any
    meta?: any,
  ): void {
    let warnMessage = `Warning: ${TOPIC[message.topic]}`;
    const action = (message as Message).action;
    if (action) {
      // deno-lint-ignore no-explicit-any
      warnMessage += ` (${(ACTIONS as any)[message.topic][action]})`;
    }
    if (event) {
      // deno-lint-ignore no-explicit-any
      warnMessage += `: ${(EVENT as any)[event]}`;
    }
    if (meta) {
      warnMessage += ` – ${
        typeof meta === "string" ? meta : JSON.stringify(meta)
      }`;
    }
    console.warn(warnMessage);
  }

  error(
    message: { topic: TOPIC } | Message,
    // deno-lint-ignore no-explicit-any
    event?: any,
    meta?: string | JSONObject | Error,
  ): void {
    if (isEvent(event)) {
      if (event === EVENT.IS_CLOSED || event === EVENT.CONNECTION_ERROR) {
        this.#emitter.emit(
          "error",
          meta,
          // deno-lint-ignore no-explicit-any
          (EVENT as any)[event],
          TOPIC[TOPIC.CONNECTION],
        );
      } else {
        this.#emitter.emit(
          "error",
          meta,
          // deno-lint-ignore no-explicit-any
          (EVENT as any)[event],
          TOPIC[message.topic],
        );
      }
    } else {
      const action = event ? event : (message as Message).action;
      this.#emitter.emit(
        "error",
        meta || message,
        // deno-lint-ignore no-explicit-any
        (ACTIONS as any)[message.topic][action],
        TOPIC[message.topic],
      );
    }
  }
}
