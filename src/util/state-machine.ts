// deno-lint-ignore-file no-explicit-any
export class StateMachine {
  state: any;
  inEndState: boolean;
  #transitions: any;
  #context: any;
  #history: any[];
  #stateMachine: any;
  constructor(_logger: any, stateMachine: any) {
    this.#stateMachine = stateMachine;
    this.inEndState = false;
    this.#transitions = stateMachine.transitions;
    this.state = stateMachine.init;
    this.#context = stateMachine.context;
    this.#history = [{
      oldState: "-",
      newState: this.state,
      transitionName: "-",
    }];
  }

  transition(transitionName: any): void {
    let transition;
    for (let i = 0; i < this.#transitions.length; i++) {
      transition = this.#transitions[i];
      if (
        transitionName === transition.name &&
        (this.state === transition.from || transition.from === undefined)
      ) {
        this.#history.push({
          oldState: this.state,
          transitionName,
          newState: transition.to,
        });
        const oldState = this.state;
        this.state = transition.to;
        if (this.#stateMachine.onStateChanged) {
          this.#stateMachine.onStateChanged.call(
            this.#context,
            this.state,
            oldState,
          );
        }
        if (transition.handler) {
          transition.handler.call(this.#context);
        }
        if (transition.isEndState === true) {
          this.inEndState = true;
        }
        return;
      }
    }
    const details = JSON.stringify({
      transition: transitionName,
      fromState: this.state,
    });
    const debugHistory = this.#history.reverse().reduce(
      (result, entry) =>
        result +=
          `\n\tFrom ${entry.oldState} to ${entry.newState} via ${entry.transitionName}`,
      "",
    );
    console.trace(
      `Invalid state transition.\nDetails: ${details} \nHistory: ${debugHistory}`,
    );
  }
}
