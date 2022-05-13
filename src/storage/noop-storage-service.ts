import { offlineStoreWriteResponse, RecordOfflineStore } from "../client.ts";
import { RecordData } from "../constants.ts";

export class NoopStorage implements RecordOfflineStore {
  isReady = true;

  get(
    recordName: string,
    callback: ((recordName: string, version: number, data: RecordData) => void),
  ) {
    setTimeout(callback.bind(this, recordName, -1, null), 0);
  }

  set(
    _recordName: string,
    _version: number,
    _data: RecordData,
    callback: offlineStoreWriteResponse,
  ) {
    setTimeout(callback, 0);
  }

  delete(_recordName: string, callback: offlineStoreWriteResponse) {
    setTimeout(callback, 0);
  }

  reset(callback: (error: string | null) => void) {
    callback(null);
  }
}
