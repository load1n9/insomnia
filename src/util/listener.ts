// deno-lint-ignore-file no-explicit-any ban-types
import {
  EVENT,
  EVENT_ACTION,
  ListenMessage,
  RECORD_ACTION,
  TOPIC,
} from "../constants.ts";
import { Services } from "../client.ts";

export interface ListenResponse {
  accept: () => void;
  reject: (reason?: string) => void;
  onStop: (callback: (subscriptionName: string) => void) => void;
}

export type ListenCallback = (
  subscriptionName: string,
  listenResponse: ListenResponse,
) => void;

export class Listener {
  #topic: TOPIC;
  #actions: any;
  #services: Services;
  #listeners: Map<string, ListenCallback>;
  #stopCallbacks: Map<string, Function>;

  constructor(topic: TOPIC, services: Services) {
    this.#topic = topic;
    this.#services = services;
    this.#listeners = new Map<string, ListenCallback>();
    this.#stopCallbacks = new Map<string, Function>();

    if (topic === TOPIC.RECORD) {
      this.#actions = RECORD_ACTION;
    } else if (topic === TOPIC.EVENT) {
      this.#actions = EVENT_ACTION;
    }

    this.#services.connection.onLost(this.#onConnectionLost.bind(this));
    this.#services.connection.onReestablished(
      this.#onConnectionReestablished.bind(this),
    );
  }

  listen(pattern: string, callback: ListenCallback): void {
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new Error("invalid argument pattern");
    }
    if (typeof callback !== "function") {
      throw new Error("invalid argument callback");
    }

    if (this.#listeners.has(pattern)) {
      this.#services.logger.warn({
        topic: this.#topic,
        action: this.#actions.LISTEN,
        name: pattern,
      }, EVENT.LISTENER_EXISTS);
      return;
    }

    this.#listeners.set(pattern, callback);
    this.#sendListen(pattern);
  }

  unlisten(pattern: string): void {
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new Error("invalid argument pattern");
    }

    if (!this.#listeners.has(pattern)) {
      this.#services.logger.warn({
        topic: this.#topic,
        action: this.#actions.UNLISTEN,
        name: pattern,
      }, EVENT.NOT_LISTENING);
      return;
    }

    this.#listeners.delete(pattern);
    this.#sendUnlisten(pattern);
  }

  #accept(pattern: string, subscription: string): void {
    this.#services.connection.sendMessage({
      topic: this.#topic,
      action: this.#actions.LISTEN_ACCEPT,
      name: pattern,
      subscription,
    });
  }

  #reject(pattern: string, subscription: string): void {
    this.#services.connection.sendMessage({
      topic: this.#topic,
      action: this.#actions.LISTEN_REJECT,
      name: pattern,
      subscription,
    });
  }

  #stop(subscription: string, callback: Function): void {
    this.#stopCallbacks.set(subscription, callback);
  }

  handle(message: ListenMessage) {
    if (message.isAck) {
      this.#services.timeoutRegistry.remove(message);
      return;
    }
    if (message.action === this.#actions.SUBSCRIPTION_FOR_PATTERN_FOUND) {
      const listener = this.#listeners.get(message.name as string);
      if (listener) {
        listener(
          message.subscription as string,
          {
            accept: this.#accept.bind(this, message.name, message.subscription),
            reject: this.#reject.bind(this, message.name, message.subscription),
            onStop: this.#stop.bind(this, message.subscription),
          },
        );
      }
      return;
    }

    if (message.action === this.#actions.SUBSCRIPTION_FOR_PATTERN_REMOVED) {
      const stopCallback = this.#stopCallbacks.get(
        message.subscription as string,
      );
      if (stopCallback) {
        stopCallback(message.subscription);
        this.#stopCallbacks.delete(message.subscription as string);
      }
      return;
    }

    this.#services.logger.error(message, EVENT.UNSOLICITED_MESSAGE);
  }

  #onConnectionLost() {
    this.#stopCallbacks.forEach((callback, subscription) => {
      callback(subscription);
    });
    this.#stopCallbacks.clear();
  }

  #onConnectionReestablished() {
    this.#listeners.forEach((_callback, pattern) => {
      this.#sendListen(pattern);
    });
  }

  #sendListen(pattern: string): void {
    const message = {
      topic: this.#topic,
      action: this.#actions.LISTEN,
      name: pattern,
    };
    this.#services.timeoutRegistry.add({ message });
    this.#services.connection.sendMessage(message);
  }

  #sendUnlisten(pattern: string): void {
    const message = {
      topic: this.#topic,
      action: this.#actions.UNLISTEN,
      name: pattern,
    };
    this.#services.timeoutRegistry.add({ message });
    this.#services.connection.sendMessage(message);
  }
}
