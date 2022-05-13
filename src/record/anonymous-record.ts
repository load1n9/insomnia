// deno-lint-ignore-file no-explicit-any
import * as utils from "../util/utils.ts";
import { RecordCore, WriteAckCallback } from "./record-core.ts";
import { MergeStrategy } from "./merge-strategy.ts";
import { Emitter } from "../util/emitter.ts";

export class AnonymousRecord extends Emitter {
  #record: RecordCore<AnonymousRecord> | null;
  #subscriptions: utils.RecordSubscribeArguments[];
  #getRecordCore: (recordName: string) => RecordCore<AnonymousRecord>;

  constructor(
    getRecordCore: (recordName: string) => RecordCore<AnonymousRecord>,
  ) {
    super();
    this.#record = null;
    this.#subscriptions = [];
    this.#getRecordCore = getRecordCore;
  }

  get name(): string {
    return !this.#record ? "" : this.#record.name;
  }

  get isReady(): boolean {
    return !this.#record ? false : this.#record.isReady;
  }

  get version(): number {
    return !this.#record ? -1 : this.#record.version as number;
  }

  whenReady(): Promise<AnonymousRecord>;
  whenReady(callback: ((record: AnonymousRecord) => void)): void;
  whenReady(
    callback?: ((record: AnonymousRecord) => void),
  ): void | Promise<AnonymousRecord> {
    if (this.#record) {
      if (callback) {
        this.#record.whenReady(this, callback);
      } else {
        return this.#record.whenReady(this);
      }
    }
  }

  setName(recordName: string): Promise<AnonymousRecord>;
  setName(
    recordName: string,
    callback: (record: AnonymousRecord) => void,
  ): void;
  setName(
    recordName: string,
    callback?: (record: AnonymousRecord) => void,
  ): void | Promise<AnonymousRecord> {
    if (this.name === recordName) {
      return;
    }

    this.discard();

    this.#record = this.#getRecordCore(recordName);
    this.#record.addReference(this);

    for (let i = 0; i < this.#subscriptions.length; i++) {
      this.#record.subscribe(this.#subscriptions[i], this);
    }

    this.emit("nameChanged", recordName);

    if (callback) {
      this.#record.whenReady(this, callback);
    } else {
      return this.#record.whenReady(this);
    }
  }

  get(path?: string): any {
    if (this.#record) {
      return this.#record.get(path);
    }
  }

  set(data: any, callback?: WriteAckCallback): void;
  set(_path: string, _data: any, _callback?: WriteAckCallback): void {
    if (this.#record) {
      return this.#record.set(utils.normalizeSetArguments(arguments));
    }
  }

  setWithAck(
    data: any,
    callback?: ((error: string) => void),
  ): Promise<void> | void;
  setWithAck(
    _path: string,
    _data: any,
    _callback?: ((error: string) => void),
  ): Promise<void> | void {
    if (this.#record) {
      return this.#record.setWithAck(utils.normalizeSetArguments(arguments));
    }
  }

  erase(_path: string): void {
    if (this.#record) {
      return this.#record.set(utils.normalizeSetArguments(arguments));
    }
  }

  eraseWithAck(
    _path: string,
    _callback?: ((error: string) => void),
  ): Promise<void> | void {
    if (this.#record) {
      return this.#record.setWithAck(utils.normalizeSetArguments(arguments));
    }
  }

  subscribe(
    _path: string,
    _callback: (data: any) => void,
    _triggerNow?: boolean,
  ) {
    const parameters = utils.normalizeArguments(arguments);
    this.#subscriptions.push(parameters);
    if (this.#record) {
      this.#record.subscribe(parameters, this);
    }
  }

  unsubscribe(_path: string, _callback: (data: any) => void) {
    const parameters = utils.normalizeArguments(arguments);

    this.#subscriptions = this.#subscriptions.filter((subscription) => {
      if (!parameters.callback && (subscription.path === parameters.path)) {
        return false;
      }
      if (
        parameters.callback &&
        (subscription.path === parameters.path &&
          subscription.callback === parameters.callback)
      ) {
        return false;
      }
      return true;
    });

    if (this.#record) {
      this.#record.unsubscribe(parameters, this);
    }
  }

  discard(): void {
    if (this.#record) {
      for (let i = 0; i < this.#subscriptions.length; i++) {
        this.#record.unsubscribe(this.#subscriptions[i], this);
      }
      return this.#record.removeReference(this);
    }
  }

  delete(callback?: (error: string | null) => void): void | Promise<void> {
    if (this.#record) {
      return this.#record.delete(callback);
    }
  }

  setMergeStrategy(mergeStrategy: MergeStrategy): void {
    if (this.#record) {
      this.#record.setMergeStrategy(mergeStrategy);
    }
  }
}
