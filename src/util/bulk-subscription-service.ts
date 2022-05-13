import { Services } from "../client.ts";
import { Message, TOPIC } from "../constants.ts";

export class BulkSubscriptionService<ACTION> {
  #subscribeNames = new Set<string>();
  #unsubscribeNames = new Set<string>();
  #timerRef = -1;
  #correlationId = 0;
  #subscriptionInterval: number;
  #topic: TOPIC;
  services: Services;
  #subscribeBulkAction: ACTION;
  #unsubscribeBulkAction: ACTION;
  #onSubscriptionSent: (message: Message) => void = (() => {});
  constructor(
    services: Services,
    subscriptionInterval: number,
    topic: TOPIC,
    subscribeBulkAction: ACTION,
    unsubscribeBulkAction: ACTION,
    onSubscriptionSent: (message: Message) => void = (() => {}),
  ) {
    this.#subscribeBulkAction = subscribeBulkAction;
    this.#unsubscribeBulkAction = unsubscribeBulkAction;
    this.#onSubscriptionSent = onSubscriptionSent;
    this.#topic = topic;
    this.#subscriptionInterval = subscriptionInterval;
    this.services = services;
    this.services.connection.onLost(this.onLost.bind(this));
  }

  subscribe(name: string) {
    if (this.#subscriptionInterval > 0) {
      if (this.#unsubscribeNames.has(name)) {
        this.#unsubscribeNames.delete(name);
      } else {
        this.#subscribeNames.add(name);
        this.#registerFlush();
      }
      return;
    }

    const message = {
      topic: this.#topic,
      // deno-lint-ignore no-explicit-any
      action: this.#subscribeBulkAction as any,
      names: [name],
      correlationId: (this.#correlationId++).toString(),
    };
    this.services.connection.sendMessage(message);
    this.#onSubscriptionSent(message);
  }

  subscribeList(users: string[]) {
    users.forEach(this.subscribe.bind(this));
  }

  unsubscribe(name: string) {
    if (this.#subscriptionInterval > 0) {
      if (this.#subscribeNames.has(name)) {
        this.#subscribeNames.delete(name);
      } else {
        this.#unsubscribeNames.add(name);
        this.#registerFlush();
      }
      return;
    }

    const message = {
      topic: this.#topic,
      // deno-lint-ignore no-explicit-any
      action: this.#unsubscribeBulkAction as any,
      names: [name],
      correlationId: (this.#correlationId++).toString(),
    };
    this.services.connection.sendMessage(message);
    this.#onSubscriptionSent(message);
  }

  unsubscribeList(users: string[]) {
    users.forEach(this.unsubscribe.bind(this));
  }

  #registerFlush() {
    if (!this.services.timerRegistry.has(this.#timerRef)) {
      this.#timerRef = this.services.timerRegistry.add({
        callback: this.#sendMessages,
        context: this,
        duration: this.#subscriptionInterval,
      });
    }
  }

  #sendMessages() {
    if (!this.services.connection.isConnected) {
      this.onLost();
      return;
    }

    if (this.#subscribeNames.size > 0) {
      const message = {
        topic: this.#topic,
        // deno-lint-ignore no-explicit-any
        action: this.#subscribeBulkAction as any,
        names: [...this.#subscribeNames],
        correlationId: (this.#correlationId++).toString(),
      };
      this.services.connection.sendMessage(message);
      this.#onSubscriptionSent(message);
      this.#subscribeNames.clear();
    }

    if (this.#unsubscribeNames.size > 0) {
      const message = {
        topic: this.#topic,
        // deno-lint-ignore no-explicit-any
        action: this.#unsubscribeBulkAction as any,
        names: [...this.#unsubscribeNames],
        correlationId: (this.#correlationId++).toString(),
      };
      this.services.connection.sendMessage(message);
      this.#onSubscriptionSent(message);
      this.#unsubscribeNames.clear();
    }
  }

  onLost() {
    this.#correlationId = 0;
    this.services.timerRegistry.remove(this.#timerRef);
    this.#subscribeNames.clear();
    this.#unsubscribeNames.clear();
  }
}
