export { TOPIC } from "./general.ts";
export { RECORD_ACTION } from "./record.ts";
export { AUTH_ACTION } from "./auth.ts";
export { EVENT_ACTION } from "./event.ts";
export { RPC_ACTION } from "./rpc.ts";
export { PRESENCE_ACTION } from "./presence.ts";
export { CONNECTION_ACTION } from "./connection.ts";
export { CLUSTER_ACTION } from "./cluster.ts";
export { LOCK_ACTION } from "./lock.ts";
export { PARSER_ACTION } from "./parser.ts";
export { MONITORING_ACTION } from "./monitoring.ts";
export { STATE_ACTION, STATE_REGISTRY_TOPIC } from "./state.ts";

export type JSONPrimitive = string | number | boolean | null;
export interface JSONObject {
  [member: string]: JSONValue;
}
// deno-lint-ignore no-empty-interface
export interface JSONArray extends Array<JSONValue> {}
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;

export type RecordPathData = JSONValue;
export type RecordData = JSONObject | Array<string> | null | undefined;
export type RPCResult = JSONValue;
export type EventData = JSONValue;
export type AuthData = JSONObject;
