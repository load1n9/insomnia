// deno-lint-ignore-file ban-types no-explicit-any
import { DefaultOptions, Options } from "./client-options.ts";
import * as C from "./constants.ts";
import {
  CONNECTION_STATE,
  JSONObject,
  Message,
  RecordData,
} from "./constants.ts";
import { Logger } from "./util/logger.ts";
import { TimeoutRegistry } from "./util/timeout-registry.ts";
import { IntervalTimerRegistry } from "./util/interval-timer-registry.ts";
import { NativeTimerRegistry } from "./util/native-timer-registry.ts";
import {
  AuthenticationCallback,
  Connection,
  ResumeCallback,
} from "./connection/connection.ts";
import { SocketFactory, socketFactory } from "./connection/socket-factory.ts";
import { EventHandler } from "./event/event-handler.ts";
import { RPCHandler } from "./rpc/rpc-handler.ts";
import { RecordHandler } from "./record/record-handler.ts";
import { PresenceHandler } from "./presence/presence-handler.ts";
import { Emitter } from "./util/emitter.ts";
import { Storage } from "./storage/indexdb-storage-service.ts";
import { NoopStorage } from "./storage/noop-storage-service.ts";

export type offlineStoreWriteResponse = ((
  error: string | null,
  recordName: string,
) => void);

export interface RecordOfflineStore {
  get: (
    recordName: string,
    callback: ((recordName: string, version: number, data: RecordData) => void),
  ) => void;
  set: (
    recordName: string,
    version: number,
    data: RecordData,
    callback: offlineStoreWriteResponse,
  ) => void;
  delete: (recordName: string, callback: offlineStoreWriteResponse) => void;
  reset: (callback: (error: string | null) => void) => void;
}

export type TimerRef = number;
export interface Timeout {
  callback: Function;
  duration: number;
  context: any;
  data?: any;
}

export interface TimerRegistry {
  close(): void;
  has(timerId: TimerRef): boolean;
  add(timeout: Timeout): TimerRef;
  remove(timerId: TimerRef): boolean;
  requestIdleCallback(callback: Function): void;
}

export interface Socket {
  close: () => void;
  onparsedmessages: (messages: Message[]) => void;
  onclosed: () => void;
  onopened: () => void;
  onerror: (error: any) => void;
  sendParsedMessage: (message: Message) => void;
  getTimeSinceLastMessage: () => number;
}

export interface Services {
  logger: Logger;
  connection: Connection;
  timeoutRegistry: TimeoutRegistry;
  timerRegistry: TimerRegistry;
  socketFactory: SocketFactory;
  storage: RecordOfflineStore;
}

export class InsomniaClient extends Emitter {
  event: EventHandler;
  rpc: RPCHandler;
  record: RecordHandler;
  presence: PresenceHandler;
  #services: Services;
  #options: Options;

  constructor(url: string, options: Partial<Options> = {}) {
    super();
    this.#options = { ...DefaultOptions, ...options } as Options;
    const services: Partial<Services> = {};

    services.timerRegistry = options.nativeTimerRegistry
      ? new NativeTimerRegistry()
      : new IntervalTimerRegistry(
        this.#options.intervalTimerResolution,
      );

    services.timeoutRegistry = new TimeoutRegistry(
      services as Services,
      this.#options,
    );
    services.socketFactory = this.#options.socketFactory || socketFactory;
    services.connection = new Connection(
      services as Services,
      this.#options,
      url,
      this,
    );
    services.storage = this.#options.offlineEnabled
      ? this.#options.storage || new Storage(this.#options)
      : new NoopStorage();

    this.#services = services as Services;

    this.#services.connection.onLost(
      services.timeoutRegistry.onConnectionLost.bind(services.timeoutRegistry),
    );

    this.event = new EventHandler(this.#services, this.#options);
    this.rpc = new RPCHandler(this.#services, this.#options);
    this.record = new RecordHandler(this.#services, this.#options);
    this.presence = new PresenceHandler(this.#services, this.#options);
  }
  login(): Promise<JSONObject>;
  login(callback: AuthenticationCallback): void;
  login(details: JSONObject): Promise<JSONObject>;
  login(details: JSONObject, callback: AuthenticationCallback): void;
  login(
    detailsOrCallback?: JSONObject | AuthenticationCallback,
    callback?: AuthenticationCallback,
  ): void | Promise<JSONObject | null> {
    if (detailsOrCallback && typeof detailsOrCallback === "object") {
      if (callback) {
        this.#services.connection.authenticate(detailsOrCallback, callback);
      } else {
        return new Promise((resolve, reject) => {
          this.#services.connection.authenticate(
            detailsOrCallback,
            (success, data) => {
              success ? resolve(data) : reject(data);
            },
          );
        });
      }
    } else {
      if (typeof detailsOrCallback === "function") {
        this.#services.connection.authenticate({}, detailsOrCallback);
      } else {
        return new Promise((resolve, reject) => {
          this.#services.connection.authenticate({}, (success, data) => {
            success ? resolve(data) : reject(data);
          });
        });
      }
    }
  }
  getConnectionState(): CONNECTION_STATE {
    return this.#services.connection.getConnectionState();
  }
  close(): void {
    Object.keys(this.#services).forEach((serviceName) => {
      if ((this.#services as any)[serviceName].close) {
        (this.#services as any)[serviceName].close();
      }
    });
  }
  pause(): void {
    this.#services.connection.pause();
  }
  resume(callback?: ResumeCallback): void | Promise<void> {
    if (callback) {
      this.#services.connection.resume(callback);
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.#services.connection.resume((error) => {
        error ? reject(error) : resolve();
      });
    });
  }
  getUid(): string {
    return `${new Date().getTime().toString(36)}-${
      crypto.randomUUID().replace("-", "")
    }`;
  }
}
export { C, DefaultOptions };
