import { TopicMessage } from "./protobuf-map.ts";
import { ParseResult } from "../types/messages.ts";
import { Message } from "./protobuf.js";
import { PARSER_ACTION, TOPIC } from "../types/all.ts";
import { Buffer } from "https://deno.land/std@0.139.0/node/buffer.ts";

export interface RawMessage {
  fin: boolean;
  topic: number;
  action: number;
  meta?: Buffer;
  payload?: Buffer;
  rawHeader: Buffer;
}

export function parse(data: Uint8Array): Array<ParseResult> {
  try {
    const msg = Message.decodeDelimited(data);
    const message = TopicMessage[msg.topic].decode(
      msg.message,
      msg.message.length,
    );
    return [{ topic: msg.topic, ...message }];
  } catch (_e) {
    return [{ topic: TOPIC.PARSER, action: PARSER_ACTION.ERROR }];
  }
}

// deno-lint-ignore no-explicit-any
export function parseData(message: any): boolean | Error {
  if (message.parsedData !== undefined || message.data === undefined) {
    return true;
  }

  message.parsedData = JSON.parse(message.data);
  return message.parsedData === undefined
    ? new Error(`unable to parse data ${message.data}`)
    : true;
}
