// deno-lint-ignore-file no-explicit-any ban-types
import * as utils from "../util/utils.ts";
import { EVENT, RecordMessage } from "../constants.ts";
import { RecordCore, WriteAckCallback } from "./record-core.ts";
import { Emitter } from "../util/emitter.ts";

export class List extends Emitter {
  debugId: any;
  #wrappedFunctions: Map<Function, Function> = new Map();
  #originalApplyUpdate: Function;
  #beforeStructure: any;
  #hasAddListener = false;
  #hasRemoveListener = false;
  #hasMoveListener = false;
  #subscriptions: utils.RecordSubscribeArguments[] = [];
  #record: RecordCore<List>;
  constructor(record: RecordCore<List>) {
    super();
    this.#record = record;
    this.debugId = this.#record.getDebugId();
    this.#originalApplyUpdate = this.#record.applyUpdate.bind(this.#record);
    this.#record.applyUpdate = this.#applyUpdate.bind(this);
    this.#record.addReference(this);
    this.#record.on("discard", () => this.emit("discard", this), this);
    this.#record.on("delete", () => this.emit("delete", this), this);
    this.#record.on(
      "error",
      (...args: any[]) => this.emit("error", ...args),
      this,
    );
  }

  get name(): string {
    return this.#record.name;
  }

  get isReady(): boolean {
    return this.#record.isReady;
  }

  get version(): number {
    return this.#record.version as number;
  }

  whenReady(): Promise<List>;
  whenReady(callback: ((list: List) => void)): void;
  whenReady(callback?: ((list: List) => void)): void | Promise<List> {
    if (callback) {
      this.#record.whenReady(this, callback);
    } else {
      return this.#record.whenReady(this);
    }
  }

  discard(): void {
    this.#destroy();
    this.#record.removeReference(this);
  }

  delete(callback: (error: string | null) => void): void;
  delete(): Promise<void>;
  delete(callback?: (error: string | null) => void): void | Promise<void> {
    this.#destroy();
    return this.#record.delete(callback);
  }

  getEntries(): string[] {
    const entries = this.#record.get();
    return !(entries instanceof Array) ? [] : entries as string[];
  }

  isEmpty(): boolean {
    return this.getEntries().length === 0;
  }

  setEntriesWithAck(entries: string[]): Promise<void>;
  setEntriesWithAck(entries: string[], callback: WriteAckCallback): void;
  setEntriesWithAck(
    entries: string[],
    callback?: WriteAckCallback,
  ): Promise<void> | void {
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.setEntries(entries, (error: string | null) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
    this.setEntries(entries, callback);
  }

  setEntries(entries: string[], callback?: WriteAckCallback) {
    const errorMsg = "entries must be an array of record names";
    let i;

    if (!(entries instanceof Array)) {
      throw new Error(errorMsg);
    }

    for (i = 0; i < entries.length; i++) {
      if (typeof entries[i] !== "string") {
        throw new Error(errorMsg);
      }
    }

    this.#beforeChange();
    this.#record.set({ data: entries, callback });
    this.#afterChange();
  }

  removeEntry(entry: string, index?: number, callback?: WriteAckCallback) {
    const currentEntries: string[] = this.#record.get() as string[];
    const hasIndex = this.#hasIndex(index);
    const entries: string[] = [];
    let i;

    for (i = 0; i < currentEntries.length; i++) {
      if (currentEntries[i] !== entry || (hasIndex && index !== i)) {
        entries.push(currentEntries[i]);
      }
    }
    this.#beforeChange();
    this.#record.set({ data: entries, callback });
    this.#afterChange();
  }

  addEntry(entry: string, index?: number, callback?: WriteAckCallback) {
    if (typeof entry !== "string") {
      throw new Error("Entry must be a recordName");
    }

    const hasIndex = this.#hasIndex(index);
    const entries = this.getEntries();
    if (hasIndex) {
      entries.splice(index as number, 0, entry);
    } else {
      entries.push(entry);
    }
    this.#beforeChange();
    this.#record.set({ data: entries, callback });
    this.#afterChange();
  }

  subscribe(_callback: (entries: string[]) => void) {
    const parameters = utils.normalizeArguments(arguments);

    if (parameters.path) {
      throw new Error("path is not supported for List.subscribe");
    }

    const listCallback = function (scope: any, cb: Function) {
      cb(scope.getEntries());
    }.bind(this, this, parameters.callback);

    this.#wrappedFunctions.set(parameters.callback, listCallback);
    parameters.callback = listCallback;

    this.#subscriptions.push(parameters);
    this.#record.subscribe(parameters, this);
  }

  unsubscribe(_callback: (entries: string[]) => void) {
    const parameters = utils.normalizeArguments(arguments);

    if (parameters.path) {
      throw new Error("path is not supported for List.unsubscribe");
    }

    const listenCallback = this.#wrappedFunctions.get(parameters.callback);
    parameters.callback = listenCallback as (data: any) => void;
    this.#wrappedFunctions.delete(parameters.callback);
    this.#subscriptions = this.#subscriptions.filter(
      (subscription: any): boolean => {
        return parameters.callback &&
          parameters.callback !== subscription.callback;
      },
    );

    this.#record.unsubscribe(parameters, this);
  }

  #applyUpdate(message: RecordMessage) {
    if (!(message.parsedData instanceof Array)) {
      message.parsedData = [];
    }

    this.#beforeChange();
    this.#originalApplyUpdate(message);
    this.#afterChange();
  }

  #hasIndex(index?: number) {
    let hasIndex = false;
    const entries = this.getEntries();
    if (index !== undefined) {
      if (isNaN(index)) {
        throw new Error("Index must be a number");
      }
      if (index !== entries.length && (index >= entries.length || index < 0)) {
        throw new Error("Index must be within current entries");
      }
      hasIndex = true;
    }
    return hasIndex;
  }

  #beforeChange(): void {
    this.#hasAddListener = this.hasListeners(EVENT.ENTRY_ADDED_EVENT);
    this.#hasRemoveListener = this.hasListeners(EVENT.ENTRY_REMOVED_EVENT);
    this.#hasMoveListener = this.hasListeners(EVENT.ENTRY_MOVED_EVENT);

    if (
      this.#hasAddListener || this.#hasRemoveListener || this.#hasMoveListener
    ) {
      this.#beforeStructure = this.#getStructure();
    } else {
      this.#beforeStructure = null;
    }
  }

  #afterChange(): void {
    if (this.#beforeStructure === null) {
      return;
    }

    const after = this.#getStructure();
    const before = this.#beforeStructure;
    let entry;
    let i;

    if (this.#hasRemoveListener) {
      for (entry in before) {
        for (i = 0; i < before[entry].length; i++) {
          if (after[entry] === undefined || after[entry][i] === undefined) {
            this.emit(EVENT.ENTRY_REMOVED_EVENT, entry, before[entry][i]);
          }
        }
      }
    }

    if (this.#hasAddListener || this.#hasMoveListener) {
      for (entry in after) {
        if (before[entry] === undefined) {
          for (i = 0; i < after[entry].length; i++) {
            this.emit(EVENT.ENTRY_ADDED_EVENT, entry, after[entry][i]);
          }
        } else {
          for (i = 0; i < after[entry].length; i++) {
            if (before[entry][i] !== after[entry][i]) {
              if (before[entry][i] === undefined) {
                this.emit(EVENT.ENTRY_ADDED_EVENT, entry, after[entry][i]);
              } else {
                this.emit(EVENT.ENTRY_MOVED_EVENT, entry, after[entry][i]);
              }
            }
          }
        }
      }
    }
  }

  #getStructure(): any {
    const structure: any = {};
    let i;
    const entries = this.getEntries();

    for (i = 0; i < entries.length; i++) {
      if (structure[entries[i]] === undefined) {
        structure[entries[i]] = [i];
      } else {
        structure[entries[i]].push(i);
      }
    }

    return structure;
  }

  #destroy() {
    for (let i = 0; i < this.#subscriptions.length; i++) {
      this.#record.unsubscribe(this.#subscriptions[i], this);
    }
    this.#wrappedFunctions.clear();
    this.#record.removeContext(this);
  }
}
