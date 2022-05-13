import { Services } from "../client.ts";
import { Options } from "../client-options.ts";
import {
  EVENT,
  EVENT_ACTION,
  EventData,
  EventMessage,
  ListenMessage,
  Message,
  TOPIC,
} from "../constants.ts";
import { ListenCallback, Listener } from "../util/listener.ts";
import { Emitter } from "../util/emitter.ts";
import { BulkSubscriptionService } from "../util/bulk-subscription-service.ts";

export class EventHandler {
  #emitter = new Emitter();
  #listeners: Listener;
  #limboQueue: EventMessage[] = [];
  #bulkSubscription: BulkSubscriptionService<EVENT_ACTION>;
  #services: Services;
  constructor(
    services: Services,
    options: Options,
    listeners?: Listener,
  ) {
    this.#services = services;
    this.#bulkSubscription = new BulkSubscriptionService<EVENT_ACTION>(
      this.#services,
      options.subscriptionInterval,
      TOPIC.EVENT,
      EVENT_ACTION.SUBSCRIBE,
      EVENT_ACTION.UNSUBSCRIBE,
      this.#onBulkSubscriptionSent.bind(this),
    );

    this.#listeners = listeners || new Listener(TOPIC.EVENT, services);
    this.#services.connection.registerHandler(
      TOPIC.EVENT,
      this.#handle.bind(this),
    );
    this.#services.connection.onExitLimbo(this.#onExitLimbo.bind(this));
    this.#services.connection.onReestablished(
      this.#onConnectionReestablished.bind(this),
    );
  }

  eventNames(): string[] {
    return this.#emitter.eventNames();
  }

  subscribe(name: string, callback: (data: EventData) => void) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }
    if (typeof callback !== "function") {
      throw new Error("invalid argument callback");
    }

    if (!this.#emitter.hasListeners(name)) {
      if (this.#services.connection.isConnected) {
        this.#bulkSubscription.subscribe(name);
      }
    }
    this.#emitter.on(name, callback);
  }

  unsubscribe(name: string, callback: (data: EventData) => void): void {
    if (!name || typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }
    if (callback !== undefined && typeof callback !== "function") {
      throw new Error("invalid argument callback");
    }

    if (!this.#emitter.hasListeners(name)) {
      this.#services.logger.warn({
        topic: TOPIC.EVENT,
        action: EVENT_ACTION.NOT_SUBSCRIBED,
        name,
      });
      return;
    }

    this.#emitter.off(name, callback);

    if (!this.#emitter.hasListeners(name)) {
      this.#bulkSubscription.unsubscribe(name);
    }
  }

  emit(name: string, data: EventData): void {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("invalid argument name");
    }

    const message = {
      topic: TOPIC.EVENT,
      action: EVENT_ACTION.EMIT,
      name,
      parsedData: data,
    };

    if (this.#services.connection.isConnected) {
      this.#services.connection.sendMessage(message);
    } else if (this.#services.connection.isInLimbo) {
      this.#limboQueue.push(message as EventMessage);
    }

    this.#emitter.emit(name, data);
  }

  listen(pattern: string, callback: ListenCallback) {
    this.#listeners.listen(pattern, callback);
  }

  unlisten(pattern: string) {
    this.#listeners.unlisten(pattern);
  }

  #handle(message: EventMessage): void {
    if (message.isAck) {
      this.#services.timeoutRegistry.remove(message);
      return;
    }

    if (message.action === EVENT_ACTION.EMIT) {
      if (message.parsedData !== undefined) {
        this.#emitter.emit(message.name as string, message.parsedData);
      } else {
        this.#emitter.emit(message.name as string, undefined);
      }
      return;
    }

    if (message.action === EVENT_ACTION.MESSAGE_DENIED) {
      this.#services.logger.error(
        { topic: TOPIC.EVENT },
        EVENT_ACTION.MESSAGE_DENIED,
      );
      this.#services.timeoutRegistry.remove(message);
      if (message.originalAction === EVENT_ACTION.SUBSCRIBE) {
        this.#emitter.off(message.name);
      }
      return;
    }

    if (
      message.action === EVENT_ACTION.MULTIPLE_SUBSCRIPTIONS ||
      message.action === EVENT_ACTION.NOT_SUBSCRIBED
    ) {
      this.#services.timeoutRegistry.remove({
        ...message,
        action: EVENT_ACTION.SUBSCRIBE,
      });
      this.#services.logger.warn(message);
      return;
    }

    if (
      message.action === EVENT_ACTION.SUBSCRIPTION_FOR_PATTERN_FOUND ||
      message.action === EVENT_ACTION.SUBSCRIPTION_FOR_PATTERN_REMOVED
    ) {
      this.#listeners.handle(message as ListenMessage);
      return;
    }

    if (message.action === EVENT_ACTION.INVALID_LISTEN_REGEX) {
      this.#services.logger.error(message);
      return;
    }

    this.#services.logger.error(message, EVENT.UNSOLICITED_MESSAGE);
  }

  #onConnectionReestablished() {
    this.#bulkSubscription.subscribeList(this.#emitter.eventNames());

    for (let i = 0; i < this.#limboQueue.length; i++) {
      this.#services.connection.sendMessage(this.#limboQueue[i]);
    }
    this.#limboQueue = [];
  }

  #onExitLimbo() {
    this.#limboQueue = [];
  }

  #onBulkSubscriptionSent(message: Message) {
    this.#services.timeoutRegistry.add({ message });
  }
}
