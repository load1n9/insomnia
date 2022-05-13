import { RecordData } from "../constants.ts";

export type MergeCompleteCallback = (
  error: string | null,
  mergedData: RecordData,
) => void;
export type MergeStrategy = (
  localValue: RecordData,
  localVersion: number,
  remoteValue: RecordData,
  remoteVersion: number,
  callback: MergeCompleteCallback,
) => void;

/**
 *  Choose the server's state over the client's
 */
export const REMOTE_WINS = (
  _localValue: RecordData,
  _localVersion: number,
  remoteValue: RecordData,
  _remoteVersion: number,
  callback: MergeCompleteCallback,
): void => {
  callback(null, remoteValue);
};
/**
 *  Choose the local state over the server's
 */
export const LOCAL_WINS = (
  localValue: RecordData,
  _localVersion: number,
  _remoteValue: RecordData,
  _remoteVersion: number,
  callback: MergeCompleteCallback,
): void => {
  callback(null, localValue);
};
