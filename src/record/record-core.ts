// deno-lint-ignore-file no-explicit-any ban-types
import { offlineStoreWriteResponse, Services } from "../client.ts";
import { Options } from "../client-options.ts";
import {
  EVENT,
  RECORD_ACTION,
  RecordData,
  RecordMessage,
  RecordWriteMessage,
  TOPIC,
} from "../constants.ts";
import { MergeStrategy } from "./merge-strategy.ts";
import { RecordServices } from "./record-handler.ts";
import { get as getPath, setValue as setPath } from "./json-path.ts";
import { Emitter } from "../util/emitter.ts";
import * as utils from "../util/utils.ts";
import { StateMachine } from "../util/state-machine.ts";
import { TimeoutId } from "../util/timeout-registry.ts";

export type WriteAckCallback = (
  error: null | string,
  recordName: string,
) => void;

const enum RECORD_OFFLINE_ACTIONS {
  LOADED = "LOADED",
  SUBSCRIBED = "SUBSCRIBED",
  RESUBSCRIBE = "RESUBSCRIBE",
  RESUBSCRIBED = "RESUBSCRIBED",
  INVALID_VERSION = "INVALID_VERSION",
  MERGED = "MERGED",
  UNSUBSCRIBE_FOR_REAL = "UNSUBSCRIBE_FOR_REAL",
}

export const enum RECORD_STATE {
  SUBSCRIBING = "SUBSCRIBING",
  RESUBSCRIBING = "RESUBSCRIBING",
  LOADING_OFFLINE = "LOADING_OFFLINE",
  READY = "READY",
  MERGING = "MERGING",
  UNSUBSCRIBING = "UNSUBSCRIBING",
  UNSUBSCRIBED = "UNSUBSCRIBED",
  DELETING = "DELETING",
  DELETED = "DELETED",
  ERROR = "ERROR",
}

export class RecordCore<Context = null> extends Emitter {
  isReady = false;
  hasProvider = false;
  version: number | null = null;

  references: Set<any> = new Set();
  emitter: Emitter = new Emitter();
  data: RecordData = Object.create(null);
  stateMachine: StateMachine;
  responseTimeout: TimeoutId | null = null;
  discardTimeout: TimeoutId | null = null;
  deletedTimeout: TimeoutId | null = null;
  deleteResponse: {
    callback?: (error: string | null) => void;
    reject?: (error: string) => void;
    resolve?: () => void;
  } | null = null;
  pendingWrites: utils.RecordSetArguments[] = [];
  #readyTimer = -1;
  #recordReadOnlyMode: boolean;

  readyCallbacks: Array<{ context: any; callback: Function }> = [];

  constructor(
    public name: string,
    public services: Services,
    public options: Options,
    public recordServices: RecordServices,
    public whenComplete: (recordName: string) => void,
  ) {
    super();
    this.#recordReadOnlyMode = this.options.recordReadOnlyMode &&
      this.options.recordPrefixWriteWhitelist.every((prefix) =>
        !this.name.startsWith(prefix)
      );
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }

    this.onConnectionLost = this.onConnectionLost.bind(this);
    this.onConnectionReestablished = this.onConnectionReestablished.bind(this);

    this.stateMachine = new StateMachine(
      this.services.logger,
      {
        init: RECORD_STATE.LOADING_OFFLINE,
        context: this,
        onStateChanged: this.onStateChanged,
        transitions: recordStateTransitions,
      },
    );

    this.recordServices.dirtyService.whenLoaded(
      this,
      this.#onDirtyServiceLoaded,
    );
  }

  get recordState(): RECORD_STATE {
    return this.stateMachine.state;
  }

  addReference(ref: any) {
    if (this.references.size === 0 && this.isReady) {
      this.services.timeoutRegistry.clear(this.discardTimeout!);
      this.services.timerRegistry.remove(this.#readyTimer!);
      this.#readyTimer = -1;
      this.stateMachine.transition(RECORD_ACTION.SUBSCRIBE);
    }
    this.references.add(ref);
  }

  removeReference(ref: any): void {
    if (this.checkDestroyed("discard")) {
      return;
    }

    this.whenReadyInternal(ref, () => {
      this.references.delete(ref);
      if (this.references.size === 0 && this.#readyTimer === -1) {
        this.#readyTimer = this.services.timerRegistry.add({
          duration: this.options.recordDiscardTimeout,
          callback: this.stateMachine.transition,
          context: this.stateMachine,
          data: RECORD_OFFLINE_ACTIONS.UNSUBSCRIBE_FOR_REAL,
        });
        this.stateMachine.transition(RECORD_ACTION.UNSUBSCRIBE);
      }
    });
  }

  #onDirtyServiceLoaded() {
    this.services.storage.get(this.name, (_recordName, version, data) => {
      this.services.connection.onReestablished(this.onConnectionReestablished);
      this.services.connection.onLost(this.onConnectionLost);

      if (!this.services.connection.isConnected) {
        if (version === -1) {
          if (this.#recordReadOnlyMode) {
            return;
          }
          this.version = this.options.initialRecordVersion;
          this.data = Object.create(null);
          this.recordServices.dirtyService.setDirty(this.name, true);
          this.services.storage.set(
            this.name,
            this.version,
            this.data,
            (_error) => {},
          );
        } else {
          this.version = version;
          this.data = data;
        }
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.LOADED);
        return;
      }

      if (
        version === -1 && !this.recordServices.dirtyService.isDirty(this.name)
      ) {
        this.stateMachine.transition(RECORD_ACTION.SUBSCRIBECREATEANDREAD);
      } else {
        this.version = version;
        this.data = data;
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.RESUBSCRIBE);
      }
    });
  }

  onStateChanged(newState: string, _oldState: string) {
    this.emitter.emit(EVENT.RECORD_STATE_CHANGED, newState);
  }

  whenReady(context: Context): Promise<Context>;
  whenReady(context: Context, callback: (context: Context) => void): void;
  whenReady(
    context: Context,
    callback?: (context: Context) => void | undefined,
  ): Promise<Context> | void {
    if (callback) {
      this.whenReadyInternal(context, (realContext: Context | null) => {
        callback(realContext!);
      });
      return;
    }

    return new Promise<Context>((resolve) =>
      this.whenReadyInternal(context, () => resolve(context))
    );
  }

  whenReadyInternal(
    context: Context | null,
    callback: (context: Context | null) => void,
  ): void {
    if (this.isReady === true) {
      callback(context);
      return;
    }
    this.readyCallbacks.push({ callback, context });
  }

  set({ path, data, callback }: utils.RecordSetArguments): void {
    if (!path && (data === null || typeof data !== "object")) {
      throw new Error(
        "invalid arguments, scalar values cannot be set without path",
      );
    }

    if (this.checkDestroyed("set")) {
      return;
    }

    if (this.#recordReadOnlyMode) {
      this.services.logger.error(
        { topic: TOPIC.RECORD },
        EVENT.RECORD_READ_ONLY_MODE,
        "Attempting to set data when in readonly mode, ignoring",
      );
      return;
    }

    if (this.isReady === false) {
      this.pendingWrites.push({ path, data, callback });
      return;
    }

    const oldValue = this.data;
    const newValue = setPath(oldValue, path || null, data);

    if (utils.deepEquals(oldValue, newValue)) {
      if (callback) {
        this.services.timerRegistry.requestIdleCallback(() =>
          callback(null, this.name)
        );
      }
      return;
    }

    this.applyChange(newValue);

    if (this.services.connection.isConnected) {
      this.sendUpdate(path, data, callback);
    } else {
      if (callback) {
        callback(EVENT.CLIENT_OFFLINE, this.name);
      }
      this.saveUpdate();
    }
  }

  setWithAck(args: utils.RecordSetArguments): Promise<void> | void {
    if (args.callback) {
      this.set(args);
      return;
    }

    return new Promise((resolve, reject) => {
      args.callback = (error) => error === null ? resolve() : reject(error);
      this.set(args);
    });
  }

  get(path?: string): RecordData {
    return getPath(this.data, path || null, this.options.recordDeepCopy);
  }

  subscribe(args: utils.RecordSubscribeArguments, context?: any) {
    if (
      args.path !== undefined &&
      (typeof args.path !== "string" || args.path.length === 0)
    ) {
      throw new Error("invalid argument path");
    }
    if (typeof args.callback !== "function") {
      throw new Error("invalid argument callback");
    }

    if (this.checkDestroyed("subscribe")) {
      return;
    }

    if (args.triggerNow) {
      this.whenReadyInternal(null, () => {
        this.emitter.on(args.path || "", args.callback, context);
        args.callback(this.get(args.path));
      });
    } else {
      this.emitter.on(args.path || "", args.callback, context);
    }
  }

  unsubscribe(args: utils.RecordSubscribeArguments, context?: any) {
    if (
      args.path !== undefined &&
      (typeof args.path !== "string" || args.path.length === 0)
    ) {
      throw new Error("invalid argument path");
    }
    if (args.callback !== undefined && typeof args.callback !== "function") {
      throw new Error("invalid argument callback");
    }

    if (this.checkDestroyed("unsubscribe")) {
      return;
    }

    this.emitter.off(args.path || "", args.callback, context);
  }

  delete(callback?: (error: string | null) => void): Promise<void> | void {
    if (!this.services.connection.isConnected) {
      // this.services.logger.warn({ topic: TOPIC.RECORD }, RECORD_ACTION.DELETE, 'Deleting while offline is not supported')
      if (callback) {
        this.services.timerRegistry.requestIdleCallback(() => {
          callback("Deleting while offline is not supported");
        });
        return;
      }
      return Promise.reject("Deleting while offline is not supported");
    }

    if (this.checkDestroyed("delete")) {
      return;
    }
    this.stateMachine.transition(RECORD_ACTION.DELETE);

    if (callback && typeof callback === "function") {
      this.deleteResponse = { callback };
      this.#sendDelete();
    } else {
      return new Promise(
        (resolve: () => void, reject: (error: string) => void) => {
          this.deleteResponse = { resolve, reject };
          this.#sendDelete();
        },
      );
    }
  }

  setMergeStrategy(mergeStrategy: MergeStrategy): void {
    this.recordServices.mergeStrategy.setMergeStrategyByName(
      this.name,
      mergeStrategy,
    );
  }

  saveRecordToOffline(callback: offlineStoreWriteResponse = () => {}): void {
    this.services.storage.set(
      this.name,
      this.version as number,
      this.data,
      callback,
    );
  }
  onSubscribing(): void {
    this.recordServices.readRegistry.register(
      this.name,
      this,
      this.handleReadResponse,
    );
    this.responseTimeout = this.services.timeoutRegistry.add({
      message: {
        topic: TOPIC.RECORD,
        action: RECORD_ACTION.READ_RESPONSE,
        name: this.name,
      },
    });
    if (this.#recordReadOnlyMode) {
      this.recordServices
        .bulkSubscriptionService[RECORD_ACTION.SUBSCRIBEANDREAD].subscribe(
          this.name,
        );
    } else {
      this.recordServices
        .bulkSubscriptionService[RECORD_ACTION.SUBSCRIBECREATEANDREAD]
        .subscribe(this.name);
    }
  }

  onResubscribing(): void {
    this.services.timerRegistry.remove(this.#readyTimer!);

    this.recordServices.headRegistry.register(
      this.name,
      this,
      this.handleHeadResponse,
    );
    this.responseTimeout = this.services.timeoutRegistry.add({
      message: {
        topic: TOPIC.RECORD,
        action: RECORD_ACTION.HEAD,
        name: this.name,
      },
    });
    this.recordServices.bulkSubscriptionService[RECORD_ACTION.SUBSCRIBEANDHEAD]
      .subscribe(this.name);
  }

  onReady(): void {
    this.services.timeoutRegistry.clear(this.responseTimeout!);
    this.applyPendingWrites();
    this.isReady = true;
    this.applyChange(this.data, true, false);

    this.readyCallbacks.forEach(({ context, callback }) => {
      callback.call(context, context);
    });
    this.readyCallbacks = [];
  }

  private applyPendingWrites(): void {
    const writeCallbacks: WriteAckCallback[] = [];
    const oldData = this.data;
    let newData = oldData;
    for (let i = 0; i < this.pendingWrites.length; i++) {
      const { callback, path, data } = this.pendingWrites[i];
      if (callback) {
        writeCallbacks.push(callback);
      }
      newData = setPath(newData, path || null, data);
    }
    this.pendingWrites = [];

    this.applyChange(newData);

    let runFns;

    if (writeCallbacks.length !== 0) {
      runFns = (err: any) => {
        for (let i = 0; i < writeCallbacks.length; i++) {
          writeCallbacks[i](err, this.name);
        }
      };
    }

    if (utils.deepEquals(oldData, newData)) {
      if (runFns) {
        runFns(null);
      }
      return;
    }

    if (this.services.connection.isConnected) {
      this.sendUpdate(null, newData, runFns);
    } else {
      if (runFns) {
        runFns(EVENT.CLIENT_OFFLINE);
      }
      this.saveUpdate();
    }
  }

  onUnsubscribed(): void {
    if (this.services.connection.isConnected) {
      // TODO: Remove the discard concept from an individual record into bulk
      // this.recordServices.bulkSubscriptionService[RA.SUBSCRIBEANDHEAD].unsubscribe(this.name)

      const message = {
        topic: TOPIC.RECORD,
        action: RECORD_ACTION.UNSUBSCRIBE,
        names: [this.name],
        correlationId: this.name,
      };
      this.discardTimeout = this.services.timeoutRegistry.add({ message });
      this.services.connection.sendMessage(message);
    }
    this.emit(EVENT.RECORD_DISCARDED);
    this.saveRecordToOffline(() => this.destroy());
  }

  onDeleted(): void {
    this.services.storage.delete(this.name, () => {});
    this.emit(EVENT.RECORD_DELETED);
    this.destroy();
  }

  handle(message: RecordMessage): void {
    if (
      message.action === RECORD_ACTION.PATCH ||
      message.action === RECORD_ACTION.UPDATE ||
      message.action === RECORD_ACTION.ERASE
    ) {
      if (this.stateMachine.state === RECORD_STATE.MERGING) {
        return;
      }
      this.applyUpdate(message as RecordWriteMessage);
      return;
    }

    if (message.action === RECORD_ACTION.DELETE_SUCCESS) {
      this.services.timeoutRegistry.clear(this.deletedTimeout!);
      this.stateMachine.transition(RECORD_ACTION.DELETE_SUCCESS);
      if (this.deleteResponse!.callback) {
        this.deleteResponse!.callback(null);
      } else if (this.deleteResponse!.resolve) {
        this.deleteResponse!.resolve();
      }
      return;
    }

    if (message.action === RECORD_ACTION.DELETED) {
      this.stateMachine.transition(RECORD_ACTION.DELETED);
      return;
    }

    if (message.action === RECORD_ACTION.VERSION_EXISTS) {
      this.recoverRecordFromMessage(message as RecordWriteMessage);
      return;
    }

    if (
      message.action === RECORD_ACTION.MESSAGE_DENIED ||
      message.action === RECORD_ACTION.MESSAGE_PERMISSION_ERROR ||
      message.action === RECORD_ACTION.RECORD_UPDATE_ERROR
    ) {
      if (
        message.originalAction === RECORD_ACTION.SUBSCRIBECREATEANDREAD ||
        message.originalAction === RECORD_ACTION.SUBSCRIBEANDHEAD ||
        message.originalAction === RECORD_ACTION.SUBSCRIBEANDREAD
      ) {
        const subscribeMsg = {
          ...message,
          originalAction: RECORD_ACTION.SUBSCRIBE,
        };
        const actionMsg = {
          ...message,
          originalAction:
            message.originalAction === RECORD_ACTION.SUBSCRIBECREATEANDREAD
              ? RECORD_ACTION.READ_RESPONSE
              : RECORD_ACTION.HEAD_RESPONSE,
        };
        this.services.timeoutRegistry.remove(subscribeMsg); // TODO: This doesn't contain correlationIds
        this.services.timeoutRegistry.remove(actionMsg);
        this.services.logger.error(message);
      }
      if (message.isWriteAck) {
        this.recordServices.writeAckService.recieve(message);
        return;
      }

      this.emit(
        EVENT.RECORD_ERROR,
        RECORD_ACTION[message.action],
        RECORD_ACTION[message.originalAction as number],
      );

      if (message.originalAction === RECORD_ACTION.DELETE) {
        if (this.deleteResponse!.callback) {
          this.deleteResponse!.callback(
            RECORD_ACTION[RECORD_ACTION.MESSAGE_DENIED],
          );
        } else if (this.deleteResponse!.reject) {
          this.deleteResponse!.reject(
            RECORD_ACTION[RECORD_ACTION.MESSAGE_DENIED],
          );
        }
      }
      return;
    }

    if (
      message.action === RECORD_ACTION.SUBSCRIPTION_HAS_PROVIDER ||
      message.action === RECORD_ACTION.SUBSCRIPTION_HAS_NO_PROVIDER
    ) {
      this.hasProvider =
        message.action === RECORD_ACTION.SUBSCRIPTION_HAS_PROVIDER;
      this.emit(EVENT.RECORD_HAS_PROVIDER_CHANGED, this.hasProvider);
      return;
    }

    if (
      message.action === RECORD_ACTION.CACHE_RETRIEVAL_TIMEOUT ||
      message.action === RECORD_ACTION.STORAGE_RETRIEVAL_TIMEOUT
    ) {
      this.services.logger.error(message);
      return;
    }
  }

  handleReadResponse(message: any): void {
    if (this.stateMachine.state === RECORD_STATE.MERGING) {
      this.recoverRecordFromMessage(message);
      this.recordServices.dirtyService.setDirty(this.name, false);
      return;
    }
    this.version = message.version;
    this.data = message.parsedData;

    this.stateMachine.transition(RECORD_ACTION.READ_RESPONSE);
  }

  handleHeadResponse(message: RecordMessage): void {
    const remoteVersion = message.version!;
    if (this.recordServices.dirtyService.isDirty(this.name)) {
      if (
        remoteVersion === -1 &&
        this.version === this.options.initialRecordVersion
      ) {
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.SUBSCRIBED);
        this.sendCreateUpdate(this.data);
      } else if (this.version === remoteVersion + 1) {
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.RESUBSCRIBED);
        this.sendUpdate(null, this.data);
      } else {
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.INVALID_VERSION);
        if (remoteVersion !== -1) {
          this.sendRead();
          this.recordServices.readRegistry.register(
            this.name,
            this,
            this.handleReadResponse,
          );
        } else {
          this.recoverRecordDeletedRemotely();
        }
      }
    } else {
      if (this.version === remoteVersion) {
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.RESUBSCRIBED);
      } else {
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.INVALID_VERSION);
        if (remoteVersion < (this.version as number)) {
          this.recoverRecordDeletedRemotely();
        } else {
          this.sendRead();
          this.recordServices.readRegistry.register(
            this.name,
            this,
            this.handleReadResponse,
          );
        }
      }
    }
  }

  sendRead() {
    this.services.connection.sendMessage({
      topic: TOPIC.RECORD,
      action: RECORD_ACTION.READ,
      name: this.name,
    });
  }

  saveUpdate(): void {
    if (!this.recordServices.dirtyService.isDirty(this.name)) {
      this.version!++;
      this.recordServices.dirtyService.setDirty(this.name, true);
    }
    this.saveRecordToOffline();
  }

  sendUpdate(
    path: string | null = null,
    data: RecordData,
    callback?: WriteAckCallback,
  ) {
    if (this.#recordReadOnlyMode) {
      this.services.logger.error(
        { topic: TOPIC.RECORD },
        EVENT.RECORD_READ_ONLY_MODE,
        "Attempting to send updated data, ignoring",
      );
      return;
    }

    if (this.recordServices.dirtyService.isDirty(this.name)) {
      this.recordServices.dirtyService.setDirty(this.name, false);
    } else {
      this.version!++;
    }

    const message = {
      topic: TOPIC.RECORD,
      version: this.version,
      name: this.name,
    };

    if (path) {
      if (data === undefined) {
        Object.assign(message, { action: RECORD_ACTION.ERASE, path });
      } else {
        Object.assign(message, {
          action: RECORD_ACTION.PATCH,
          path,
          parsedData: data,
        });
      }
    } else {
      Object.assign(message, {
        action: RECORD_ACTION.UPDATE,
        parsedData: data,
      });
    }
    if (callback) {
      this.recordServices.writeAckService.send(
        message as RecordWriteMessage,
        callback,
      );
    } else {
      this.services.connection.sendMessage(message as RecordWriteMessage);
    }
  }

  sendCreateUpdate(data: RecordData) {
    this.services.connection.sendMessage({
      name: this.name,
      topic: TOPIC.RECORD,
      action: RECORD_ACTION.CREATEANDUPDATE,
      version: this.options.initialRecordVersion,
      parsedData: data,
    });
    this.recordServices.dirtyService.setDirty(this.name, false);
  }

  applyUpdate(message: RecordWriteMessage) {
    const version = message.version;
    const data = message.parsedData as RecordData;

    if (this.version === null) {
      this.version = version;
    } else if (this.version + 1 !== version) {
      this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.INVALID_VERSION);
      if (message.action === RECORD_ACTION.PATCH) {
        this.sendRead();
        this.recordServices.readRegistry.register(
          this.name,
          this,
          this.handleReadResponse,
        );
      } else {
        this.recoverRecordFromMessage(message);
      }
      return;
    }

    this.version = version;
    let newData;
    if (message.action === RECORD_ACTION.PATCH) {
      newData = setPath(this.data, message.path as string, data);
    } else if (message.action === RECORD_ACTION.ERASE) {
      newData = setPath(this.data, message.path as string, undefined);
    } else {
      newData = data;
    }

    this.applyChange(newData);
  }

  applyChange(
    newData: RecordData,
    force = false,
    save = true,
  ) {
    if (this.stateMachine.inEndState) {
      return;
    }

    const oldData = this.data;
    this.data = newData;

    if (this.options.saveUpdatesOffline && save) {
      this.saveRecordToOffline();
    }

    const paths = this.emitter.eventNames();
    for (let i = 0; i < paths.length; i++) {
      const newValue = getPath(newData, paths[i], false);
      const oldValue = getPath(oldData, paths[i], false);

      if (!utils.deepEquals(newValue, oldValue) || (force && newValue)) {
        this.emitter.emit(paths[i], this.get(paths[i]));
      }
    }
  }

  #sendDelete(): void {
    this.whenReadyInternal(null, () => {
      this.services.storage.delete(this.name, () => {
        if (this.services.connection.isConnected) {
          const message = {
            topic: TOPIC.RECORD,
            action: RECORD_ACTION.DELETE,
            name: this.name,
          };
          this.deletedTimeout = this.services.timeoutRegistry.add({
            message,
            event: EVENT.RECORD_DELETE_TIMEOUT,
            duration: this.options.recordDeleteTimeout,
          });
          this.services.connection.sendMessage(message);
        } else {
          this.stateMachine.transition(RECORD_ACTION.DELETE_SUCCESS);
        }
      });
    });
  }

  recoverRecordFromMessage(message: RecordWriteMessage) {
    this.recordServices.mergeStrategy.merge(
      message,
      this.version as number,
      this.get(),
      this.onRecordRecovered,
      this,
    );
  }

  recoverRecordDeletedRemotely() {
    this.recordServices.mergeStrategy.merge(
      {
        name: this.name,
        version: -1,
        parsedData: null,
      } as RecordMessage,
      this.version as number,
      this.get(),
      this.onRecordRecovered,
      this,
    );
  }

  onRecordRecovered(
    error: string | null,
    recordMessage: RecordMessage,
    mergedData: RecordData,
  ): void {
    const { version: remoteVersion, parsedData: remoteData } = recordMessage;

    if (error) {
      this.services.logger.error(
        { topic: TOPIC.RECORD },
        EVENT.RECORD_VERSION_EXISTS,
      );
      if (recordMessage.correlationId) {
        this.recordServices.writeAckService.recieve({
          ...recordMessage,
          reason: error,
        });
      }
      return;
    }

    if (mergedData === null) {
      if (remoteVersion === -1) {
        this.services.storage.delete(this.name, () => {});
        this.stateMachine.transition(RECORD_ACTION.DELETED);
      } else {
        this.stateMachine.transition(RECORD_ACTION.DELETE);
      }
      return;
    }

    this.version = remoteVersion!;
    const oldValue = this.data;

    if (utils.deepEquals(oldValue, remoteData)) {
      if (this.stateMachine.state === RECORD_STATE.MERGING) {
        this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.MERGED);
      }
      return;
    }

    if (this.stateMachine.state !== RECORD_STATE.MERGING) {
      this.services.logger.warn({
        topic: TOPIC.RECORD,
        action: RECORD_ACTION.VERSION_EXISTS,
      });
      return;
    }

    const newValue = mergedData;
    this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.MERGED);

    let runFns;
    const writeCallbacks: WriteAckCallback[] = this.pendingWrites
      .map(({ callback }) => callback!)
      .filter((callback) => callback !== undefined);
    if (writeCallbacks.length !== 0) {
      runFns = (err: any) => {
        writeCallbacks.forEach((callback) => callback!(err, this.name));
      };
    }
    this.pendingWrites = [];

    if (utils.deepEquals(mergedData, remoteData)) {
      this.applyChange(mergedData);
      if (runFns) {
        runFns(null);
      }
      return;
    }

    if (this.#recordReadOnlyMode) {
      this.services.logger.error(
        { topic: TOPIC.RECORD },
        EVENT.RECORD_READ_ONLY_MODE,
        "Attempting to set data after merge when in readonly mode, ignoring",
      );
      return;
    }

    this.applyChange(newValue);
    this.sendUpdate(null, this.data, runFns);
  }

  checkDestroyed(methodName: string): boolean {
    if (this.stateMachine.inEndState) {
      this.services.logger.error(
        { topic: TOPIC.RECORD },
        EVENT.RECORD_ALREADY_DESTROYED,
        { methodName },
      );
      return true;
    }

    return false;
  }

  destroy() {
    this.services.timerRegistry.remove(this.#readyTimer);

    this.services.timeoutRegistry.clear(this.responseTimeout!);
    this.services.timeoutRegistry.clear(this.deletedTimeout!);
    this.services.timeoutRegistry.clear(this.discardTimeout!);
    this.services.connection.removeOnReestablished(
      this.onConnectionReestablished,
    );
    this.services.connection.removeOnLost(this.onConnectionLost);
    this.emitter.off();
    this.isReady = false;
    this.whenComplete(this.name);
  }

  onConnectionReestablished(): void {
    this.stateMachine.transition(RECORD_OFFLINE_ACTIONS.RESUBSCRIBE);
  }

  onConnectionLost(): void {
    this.saveRecordToOffline();
  }

  getDebugId(): string | null {
    if (this.options.debug) {
      return utils.getUid();
    }
    return null;
  }
}

const recordStateTransitions = [
  {
    name: RECORD_ACTION.SUBSCRIBECREATEANDREAD,
    from: RECORD_STATE.LOADING_OFFLINE,
    to: RECORD_STATE.SUBSCRIBING,
    handler: RecordCore.prototype.onSubscribing,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.LOADED,
    from: RECORD_STATE.LOADING_OFFLINE,
    to: RECORD_STATE.READY,
    handler: RecordCore.prototype.onReady,
  },
  {
    name: RECORD_ACTION.READ_RESPONSE,
    from: RECORD_STATE.SUBSCRIBING,
    to: RECORD_STATE.READY,
    handler: RecordCore.prototype.onReady,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.SUBSCRIBED,
    from: RECORD_STATE.RESUBSCRIBING,
    to: RECORD_STATE.READY,
    handler: RecordCore.prototype.onReady,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.RESUBSCRIBE,
    from: RECORD_STATE.LOADING_OFFLINE,
    to: RECORD_STATE.RESUBSCRIBING,
    handler: RecordCore.prototype.onResubscribing,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.RESUBSCRIBE,
    from: RECORD_STATE.READY,
    to: RECORD_STATE.RESUBSCRIBING,
    handler: RecordCore.prototype.onResubscribing,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.RESUBSCRIBE,
    from: RECORD_STATE.RESUBSCRIBING,
    to: RECORD_STATE.RESUBSCRIBING,
    handler: RecordCore.prototype.onResubscribing,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.RESUBSCRIBE,
    from: RECORD_STATE.SUBSCRIBING,
    to: RECORD_STATE.SUBSCRIBING,
    handler: RecordCore.prototype.onSubscribing,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.RESUBSCRIBE,
    from: RECORD_STATE.UNSUBSCRIBING,
    to: RECORD_STATE.UNSUBSCRIBING,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.RESUBSCRIBED,
    from: RECORD_STATE.RESUBSCRIBING,
    to: RECORD_STATE.READY,
    handler: RecordCore.prototype.onReady,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.INVALID_VERSION,
    from: RECORD_STATE.RESUBSCRIBING,
    to: RECORD_STATE.MERGING,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.MERGED,
    from: RECORD_STATE.MERGING,
    to: RECORD_STATE.READY,
    handler: RecordCore.prototype.onReady,
  },
  {
    name: RECORD_ACTION.DELETED,
    from: RECORD_STATE.MERGING,
    to: RECORD_STATE.DELETED,
    handler: RecordCore.prototype.onDeleted,
    isEndState: true,
  },
  {
    name: RECORD_ACTION.DELETE,
    from: RECORD_STATE.MERGING,
    to: RECORD_STATE.DELETING,
  },
  {
    name: RECORD_ACTION.DELETE,
    from: RECORD_STATE.READY,
    to: RECORD_STATE.DELETING,
  },
  {
    name: RECORD_ACTION.DELETED,
    from: RECORD_STATE.READY,
    to: RECORD_STATE.DELETED,
    handler: RecordCore.prototype.onDeleted,
    isEndState: true,
  },
  {
    name: RECORD_ACTION.DELETED,
    from: RECORD_OFFLINE_ACTIONS.UNSUBSCRIBE_FOR_REAL,
    to: RECORD_STATE.DELETED,
    handler: RecordCore.prototype.onDeleted,
    isEndState: true,
  },
  {
    name: RECORD_ACTION.DELETED,
    from: RECORD_STATE.UNSUBSCRIBING,
    to: RECORD_STATE.DELETED,
    handler: RecordCore.prototype.onDeleted,
    isEndState: true,
  },
  {
    name: RECORD_ACTION.DELETE_SUCCESS,
    from: RECORD_STATE.DELETING,
    to: RECORD_STATE.DELETED,
    handler: RecordCore.prototype.onDeleted,
    isEndState: true,
  },
  {
    name: RECORD_ACTION.UNSUBSCRIBE,
    from: RECORD_STATE.READY,
    to: RECORD_STATE.UNSUBSCRIBING,
  },
  {
    name: RECORD_ACTION.SUBSCRIBE,
    from: RECORD_STATE.UNSUBSCRIBING,
    to: RECORD_STATE.READY,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.UNSUBSCRIBE_FOR_REAL,
    from: RECORD_STATE.UNSUBSCRIBING,
    to: RECORD_STATE.UNSUBSCRIBED,
    handler: RecordCore.prototype.onUnsubscribed,
    isEndState: true,
  },
  {
    name: RECORD_OFFLINE_ACTIONS.INVALID_VERSION,
    from: RECORD_STATE.READY,
    to: RECORD_STATE.MERGING,
  },
];
