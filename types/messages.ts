import {
  AUTH_ACTION,
  AuthData,
  CLUSTER_ACTION,
  CONNECTION_ACTION,
  EVENT_ACTION,
  EventData,
  LOCK_ACTION,
  MONITORING_ACTION,
  PARSER_ACTION,
  PRESENCE_ACTION,
  RECORD_ACTION,
  RecordData,
  RPC_ACTION,
  RPCResult,
  STATE_ACTION,
  STATE_REGISTRY_TOPIC,
  TOPIC,
} from "./all.ts";
import { Buffer } from "https://deno.land/std@0.139.0/node/buffer.ts";
export type ALL_ACTIONS =
  | MONITORING_ACTION
  | STATE_ACTION
  | CLUSTER_ACTION
  | LOCK_ACTION
  | RPC_ACTION
  | EVENT_ACTION
  | RECORD_ACTION
  | PRESENCE_ACTION
  | CONNECTION_ACTION
  | AUTH_ACTION
  | PARSER_ACTION;

// deno-lint-ignore no-explicit-any
export const ACTIONS: { [index: number]: any } = {
  [TOPIC.PARSER]: PARSER_ACTION,
  [TOPIC.CONNECTION]: CONNECTION_ACTION,
  [TOPIC.AUTH]: AUTH_ACTION,
  [TOPIC.EVENT]: EVENT_ACTION,
  [TOPIC.RECORD]: RECORD_ACTION,
  [TOPIC.RPC]: RPC_ACTION,
  [TOPIC.PRESENCE]: PRESENCE_ACTION,
  [TOPIC.LOCK]: LOCK_ACTION,
  [TOPIC.STATE_REGISTRY]: STATE_ACTION,
  [TOPIC.CLUSTER]: CLUSTER_ACTION,
  [TOPIC.MONITORING]: MONITORING_ACTION,
};

export interface Message {
  topic: TOPIC | STATE_REGISTRY_TOPIC;
  action: ALL_ACTIONS;
  name?: string;

  isError?: boolean;
  isAck?: boolean;

  data?: string | Buffer;
  parsedData?: RecordData | RPCResult | EventData | AuthData;

  parseError?: false;

  // listen
  subscription?: string;

  originalTopic?: TOPIC | STATE_REGISTRY_TOPIC;
  originalAction?: ALL_ACTIONS;
  names?: Array<string>;
  reason?: string;

  // connection
  url?: string;
  protocolVersion?: string;
  sdkVersion?: string;
  sdkType?: string;

  // record
  isWriteAck?: boolean;
  correlationId?: string;
  path?: string;
  version?: number;
  versions?: { [index: string]: number };

  // state
  checksum?: number;
  fullState?: Array<string>;
  serverName?: string;
  registryTopic?: TOPIC;

  // cluster
  leaderScore?: number;
  externalUrl?: string;
  role?: string;

  // lock
  locked?: boolean;
}

export interface StateMessage extends Message {
  topic: TOPIC.STATE_REGISTRY;
  registryTopic: TOPIC;
}

export interface BulkSubscriptionMessage extends Message {
  names: Array<string>;
  correlationId: string;
}

export interface SubscriptionMessage extends Message {
  name: string;
}

export interface EventMessage extends SubscriptionMessage {
  topic: TOPIC.EVENT;
  action: EVENT_ACTION;
}

export interface RPCMessage extends SubscriptionMessage {
  topic: TOPIC.RPC;
  action: RPC_ACTION;
  correlationId: string;
}

export interface PresenceMessage extends Message {
  topic: TOPIC.PRESENCE;
  action: PRESENCE_ACTION;
  correlationId: string;
}

export interface ListenMessage extends SubscriptionMessage {
  topic: TOPIC.RECORD | TOPIC.EVENT;
  action: RECORD_ACTION | EVENT_ACTION;
  subscription: string;
  raw?: string;
}

export interface RecordMessage extends SubscriptionMessage {
  topic: TOPIC.RECORD;
  action: RECORD_ACTION;
}

export interface RecordWriteMessage extends RecordMessage {
  topic: TOPIC.RECORD;
  version: number;
  isWriteAck: boolean;
  path?: string;
  name: string;
}

export interface RecordAckMessage extends RecordMessage {
  topic: TOPIC.RECORD;
  path?: string;
  // deno-lint-ignore no-explicit-any
  data: any;
}

export interface MonitoringMessage extends Message {
  topic: TOPIC.MONITORING;
}

export interface LockMessage extends Message {
  topic: TOPIC.LOCK;
  action: LOCK_ACTION;
  name: string;
  locked: boolean;
}

export interface ClusterMessage extends Message {
  topic: TOPIC.CLUSTER;
  action: CLUSTER_ACTION;
  serverName: string;
}

export interface ParseError {
  parseError: boolean;
  action: PRESENCE_ACTION;

  parsedMessage: Message;

  raw?: Buffer;

  description?: string;
}

export type ParseResult = Message | ParseError;
