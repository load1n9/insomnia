// deno-lint-ignore-file ban-types no-explicit-any
import { RecordOfflineStore } from "../client.ts";

export type DirtyRecordsIndex = Map<string, boolean>;

export class DirtyService {
  #dirtyRecords: DirtyRecordsIndex = new Map();
  #loaded: boolean;
  #loadedCallback: Array<{ callback: Function; context: any }> = [];
  #flushTimeout: any | null = null;
  #storage: RecordOfflineStore;
  readonly #dirtyStorageName: string;

  constructor(
    storage: RecordOfflineStore,
    dirtyStorageName: string,
  ) {
    this.#storage = storage;
    this.#dirtyStorageName = dirtyStorageName;
    this.#loaded = false;
    this.save = this.save.bind(this);
    this.#load();
  }

  isDirty(recordName: string): boolean {
    return this.#dirtyRecords.has(recordName);
  }

  setDirty(recordName: string, isDirty: boolean): void {
    let changed = true;
    if (isDirty) {
      this.#dirtyRecords.set(recordName, true);
    } else {
      changed = this.#dirtyRecords.delete(recordName);
    }
    if (!this.#flushTimeout && changed) {
      this.#flushTimeout = setTimeout(this.save, 1000);
    }
  }

  save() {
    this.#storage.set(
      this.#dirtyStorageName,
      1,
      [...this.#dirtyRecords] as any,
      () => {},
    );
    if (this.#flushTimeout) {
      clearTimeout(this.#flushTimeout);
    }
    this.#flushTimeout = null;
  }

  whenLoaded(context: any, callback: () => void): void {
    if (this.#loaded) {
      callback.call(context);
      return;
    }
    this.#loadedCallback.push({ callback, context });
  }

  getAll(): DirtyRecordsIndex {
    return this.#dirtyRecords;
  }

  #load(): void {
    if (this.#loaded) {
      return;
    }
    this.#storage.get(
      this.#dirtyStorageName,
      (_recordName: string, _version: number, data: any) => {
        this.#dirtyRecords = data ? new Map(data) : new Map();
        this.#loaded = true;
        this.#loadedCallback.forEach(({ callback, context }) =>
          callback.call(context)
        );
      },
    );
  }
}
