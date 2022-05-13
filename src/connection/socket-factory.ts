import { parse } from "../../protobuf/message-parser.ts";
import { getMessage } from "../../protobuf/message-builder.ts";
import { Socket } from "../deepstream-client.ts";
import { CONNECTION_ACTION, JSONObject, Message, TOPIC } from "../constants.ts";
import { Buffer } from "https://deno.land/std@0.139.0/node/buffer.ts";

// deno-lint-ignore no-explicit-any
const BrowserWebsocket = WebSocket as any;

export type SocketFactory = (
  url: string,
  options: JSONObject,
  heartBeatInterval: number,
) => Socket;

export const socketFactory: SocketFactory = (
  url,
  options = { jsonTransportMode: false },
  heartBeatInterval,
) => {
  const socket = new BrowserWebsocket(url, [], options);

  if (BrowserWebsocket && options.jsonTransportMode !== true) {
    socket.binaryType = "arraybuffer";
  }

  const buildMessage = options.jsonTransportMode !== true
    ? getMessage
    : (message: Message, isAck: boolean) =>
      JSON.stringify({ ...message, isAck });

  const pingMessage = buildMessage({
    topic: TOPIC.CONNECTION,
    action: CONNECTION_ACTION.PING,
  }, false);
  let pingInterval: number | null = null;
  let lastRecievedMessageTimestamp = -1;

  // tslint:disable-next-line:no-empty
  socket.onparsedmessage = () => {};
  socket.onmessage = (raw: { data: Buffer | string }) => {
    lastRecievedMessageTimestamp = Date.now();
    let parseResults;
    if (options.jsonTransportMode !== true) {
      parseResults = parse(
        BrowserWebsocket
          ? new Buffer(new Uint8Array(raw.data as Buffer))
          : raw.data as Buffer,
      );
    } else {
      parseResults = [JSON.parse(raw.data as string)];
    }
    socket.onparsedmessages(parseResults);
  };
  socket.getTimeSinceLastMessage = () => {
    if (lastRecievedMessageTimestamp < 0) return 0;
    return Date.now() - lastRecievedMessageTimestamp;
  };
  socket.sendParsedMessage = (message: Message): void => {
    if (
      message.topic === TOPIC.CONNECTION &&
      message.action === CONNECTION_ACTION.CLOSING
    ) {
      socket.onparsedmessages([{
        topic: TOPIC.CONNECTION,
        action: CONNECTION_ACTION.CLOSED,
      }]);
      socket.close();
      return;
    }
    if (message.parsedData) {
      message.data = JSON.stringify(message.parsedData);
    }
    // if (message.action !== CONNECTION_ACTIONS.PONG && message.action !== CONNECTION_ACTIONS.PING) {
    //     console.log('>>>', TOPIC[message.topic], (ACTIONS as any)[message.topic][message.action], message.parsedData, message.data, message.name)
    // }
    if (message.data === undefined) {
      delete message.data;
    }
    socket.send(buildMessage(message, false));
  };

  socket.onclosed = null;
  socket.onclose = () => {
    clearInterval(pingInterval!);
    socket.onclosed();
  };

  socket.onopened = null;
  socket.onopen = () => {
    pingInterval = setInterval(() => {
      try {
        socket.send(pingMessage);
      } catch (_e) {
        clearTimeout(pingInterval!);
      }
    }, heartBeatInterval) as never as number;
    socket.onopened();
  };

  return socket;
};
