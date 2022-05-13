import { TimerRegistry, TimerRef, Timeout } from '../deepstream-client.ts'

export class NativeTimerRegistry implements TimerRegistry {
    private registry = new Set<number>()

     close () {
        this.registry.forEach(clearTimeout)
        this.registry.clear()
    }

     has (timerId: TimerRef): boolean {
        return this.registry.has(timerId)
    }

     add (timeout: Timeout): TimerRef {
        const id = setTimeout(() => {
            this.remove(id)
            timeout.callback.call(timeout.context, timeout.data)
        }, timeout.duration) as never as number
        this.registry.add(id)
        return id
    }

     remove (timerId: TimerRef): boolean {
        clearTimeout(timerId)
        return this.registry.delete(timerId)
    }

     // deno-lint-ignore no-explicit-any
     requestIdleCallback (callback: any): void {
        setTimeout(callback, 0)
    }
}
