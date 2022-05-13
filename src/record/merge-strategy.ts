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

export const REMOTE_WINS = (
  _localValue: RecordData,
  _localVersion: number,
  remoteValue: RecordData,
  _remoteVersion: number,
  callback: MergeCompleteCallback,
): void => {
  callback(null, remoteValue);
};

export const LOCAL_WINS = (
  localValue: RecordData,
  _localVersion: number,
  _remoteValue: RecordData,
  _remoteVersion: number,
  callback: MergeCompleteCallback,
): void => {
  callback(null, localValue);
};
