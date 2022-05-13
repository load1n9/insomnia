// deno-lint-ignore-file no-explicit-any
import { Services } from "../client.ts";
import { Options } from "../client-options.ts";
import { RPC_ACTION, RPCResult, TOPIC } from "../constants.ts";

export type RPCMakeCallback = (
  error: string | null,
  result?: RPCResult,
) => void;

export class RPC {
  #response: RPCMakeCallback;
  #services: Services;
  constructor(
    name: string,
    correlationId: string,
    data: any,
    response: RPCMakeCallback,
    _options: Options,
    services: Services,
  ) {
    this.#response = response;
    this.#services = services;
    const message = {
      topic: TOPIC.RPC,
      action: RPC_ACTION.REQUEST,
      correlationId,
      name,
      parsedData: data,
    };

    this.#services.connection.sendMessage(message);
  }

  accept(): void {
  }

  respond(data: any) {
    this.#response(null, data);
  }

  error(data: any) {
    this.#response(data);
  }
}
