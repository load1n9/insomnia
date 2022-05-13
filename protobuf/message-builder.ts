import {
  TopicMessage
} from './protobuf-map.ts'

import { Message } from './protobuf.js'

// deno-lint-ignore no-explicit-any
export function getMessage (message: any, isAck: boolean): Uint8Array {
  if (isAck && !message.isAck) {
    message = { ...message, isAck: true }
  }
  if (message.data === undefined && message.parsedData !== undefined) {
    message.data = JSON.stringify(message.parsedData)
  }

  const serializedMessage = TopicMessage[message.topic].encode(message).finish()
  const x = Message.encodeDelimited({ topic: message.topic, message: serializedMessage }).finish()
  return x
}
