import {
  offlineStoreWriteResponse,
  RecordOfflineStore,
} from "../deepstream-client.ts";
import "https://deno.land/x/localstorage@0.1.0/mod.ts";

const { localStorage } = window;
import { Options } from "../client-options.ts";
import { RecordData } from "../constants.ts";

export class Storage implements RecordOfflineStore {
  isReady = true;
  // deno-lint-ignore no-explicit-any
  private storage: any;

  constructor(_options: Options) {
    this.storage = localStorage;
  }

  get(
    recordName: string,
    callback: ((recordName: string, version: number, data: RecordData) => void),
  ) {
    const item = this.storage.getItem(recordName);
    if (item) {
      const doc = JSON.parse(item);
      setTimeout(callback.bind(this, recordName, doc.version, doc.data), 0);
      return;
    }
    setTimeout(callback.bind(this, recordName, -1, null), 0);
  }

  set(
    recordName: string,
    version: number,
    data: RecordData,
    callback: offlineStoreWriteResponse,
  ) {
    this.storage.setItem(
      recordName,
      JSON.stringify({ recordName, version, data }),
    );
    setTimeout(callback, 0);
  }

  delete(recordName: string, callback: offlineStoreWriteResponse) {
    this.storage.removeItem(recordName);
    setTimeout(callback, 0);
  }

  reset(callback: (error: string | null) => void) {
    callback(
      "We don't keep an index of all entries in LocalStorage, please use indexdb or delete manually",
    );
  }
}
