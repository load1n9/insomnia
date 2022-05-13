// deno-lint-ignore-file no-explicit-any
import * as utils from "../util/utils.ts";
import { EVENT, JSONObject, RecordData } from "../constants.ts";
import { RecordCore, WriteAckCallback } from "./record-core.ts";
import { MergeStrategy } from "./merge-strategy.ts";
import { Emitter } from "../util/emitter.ts";

export type SubscriptionCallback = (data: any) => void;

export class Record extends Emitter {
  debugId: string | null;
  private subscriptions: utils.RecordSubscribeArguments[] = [];

  constructor(private record: RecordCore<Record>) {
    super();
    this.debugId = this.record.getDebugId();
    this.record.on(
      EVENT.RECORD_READY,
      this.emit.bind(this, EVENT.RECORD_READY, this),
      this,
    );
    this.record.on(
      EVENT.RECORD_DISCARDED,
      this.emit.bind(this, EVENT.RECORD_DISCARDED),
      this,
    );
    this.record.on(
      EVENT.RECORD_DELETED,
      this.emit.bind(this, EVENT.RECORD_DELETED),
      this,
    );
    this.record.on(
      EVENT.RECORD_ERROR,
      this.emit.bind(this, EVENT.RECORD_ERROR),
      this,
    );

    this.record.addReference(this);
  }

  get name(): string {
    return this.record.name;
  }

  get isReady(): boolean {
    return this.record.isReady;
  }

  get version(): number {
    return this.record.version as number;
  }

  get hasProvider(): boolean {
    return this.record.hasProvider;
  }

  whenReady(): Promise<Record>;
  whenReady(callback: ((record: Record) => void)): void;
  whenReady(callback?: ((record: Record) => void)): void | Promise<Record> {
    if (callback) {
      this.record.whenReady(this, callback);
    } else {
      return this.record.whenReady(this);
    }
  }

  get(path?: string): any {
    return this.record.get(path);
  }

  set(data: JSONObject, callback?: WriteAckCallback): void;
  set(
    path: string,
    data: RecordData | undefined,
    callback?: WriteAckCallback,
  ): void;
  set(
    _dataOrPath: string | JSONObject,
    _dataOrCallback: WriteAckCallback | RecordData | undefined,
    _callback?: WriteAckCallback,
  ): void {
    return this.record.set(utils.normalizeSetArguments(arguments));
  }

  setWithAck(data: JSONObject): Promise<void>;
  setWithAck(data: JSONObject, callback: ((error: string) => void)): void;
  setWithAck(path: string, data: RecordData | undefined): Promise<void>;
  setWithAck(
    path: string,
    data: RecordData | undefined,
    callback: ((error: string) => void),
  ): void;
  setWithAck(
    data: JSONObject,
    callback?: ((error: string) => void),
  ): Promise<void> | void;
  setWithAck(
    _pathOrData: string | JSONObject,
    _dataOrCallback?: RecordData | ((error: string) => void) | undefined,
    _callback?: ((error: string) => void),
  ): Promise<void> | void {
    return this.record.setWithAck(utils.normalizeSetArguments(arguments));
  }

  /**
   * Deletes a path from the record. Equivalent to doing `record.set(path, undefined)`
   *
   * @param {String} path The path to be deleted
   */
  erase(path: string): void {
    if (!path) {
      throw new Error(
        "unable to erase record data without path, consider using `delete`",
      );
    }
    this.set(path, undefined);
  }

  /**
   * Deletes a path from the record and either takes a callback that will be called when the
   * write has been done or returns a promise that will resolve when the write is done.
   */
  eraseWithAck(path: string): Promise<void>;
  eraseWithAck(path: string, callback: ((error: string) => void)): void;
  eraseWithAck(
    path: string,
    callback?: ((error: string) => void),
  ): Promise<void> | void {
    if (!path) {
      throw new Error(
        "unable to erase record data without path, consider using `delete`",
      );
    }

    if (callback) {
      this.setWithAck(path, undefined, callback);
    } else {
      return this.setWithAck(path, undefined);
    }
  }

  subscribe(callback: SubscriptionCallback, triggerNow?: boolean): void;
  subscribe(
    path: string,
    callback: SubscriptionCallback,
    triggerNow?: boolean,
  ): void;
  subscribe(
    _pathOrCallback: string | SubscriptionCallback,
    _callbackOrTriggerNow?: SubscriptionCallback | boolean,
    _triggerNow?: boolean,
  ): void {
    const parameters = utils.normalizeArguments(arguments);
    this.subscriptions.push(parameters);
    this.record.subscribe(parameters, this);
  }

  unsubscribe(callback: SubscriptionCallback): void;
  unsubscribe(path: string, callback: SubscriptionCallback): void;
  unsubscribe(
    _pathOrCallback: string | SubscriptionCallback,
    _callback?: SubscriptionCallback,
  ): void {
    const parameters = utils.normalizeArguments(arguments);
    this.subscriptions = this.subscriptions.filter((subscription: any) => {
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

    this.record.unsubscribe(parameters, this);
  }

  discard(): void {
    for (let i = 0; i < this.subscriptions.length; i++) {
      this.record.unsubscribe(this.subscriptions[i], this);
    }
    this.record.removeReference(this);
    this.record.removeContext(this);
  }

  delete(callback?: (error: string | null) => void): void | Promise<void> {
    return this.record.delete(callback);
  }

  setMergeStrategy(mergeStrategy: MergeStrategy): void {
    this.record.setMergeStrategy(mergeStrategy);
  }
}
