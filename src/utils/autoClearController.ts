/**
 * autoClearController — the pure timer state machine that backs
 * `useAutoClearFlag` (#185). Lifted out of the hook so the timer-cleanup
 * contract can be unit-tested without React rendering infrastructure (which
 * #111 hasn't delivered yet). The hook now glues React state + a useEffect
 * cleanup to this controller; the controller itself knows nothing about
 * components, hooks, or rendering.
 *
 * The contract this enforces:
 *
 *   1. `set(value)` immediately stores the value and (if non-null) schedules
 *      a one-shot clear after `durationMs`. A subsequent `set` cancels the
 *      pending clear before scheduling the new one — rapid calls don't
 *      stack timers or race the previous clear past the new value.
 *   2. `set(null)` immediately stores null and cancels any pending clear.
 *   3. `dispose()` cancels any pending clear without changing the value.
 *      Called by the hook's useEffect cleanup so a late timer can never fire
 *      after the component unmounts. After dispose, the controller is
 *      considered torn down — `set` becomes a no-op so a delayed external
 *      caller can't accidentally resurrect a destroyed timer.
 *   4. The `onChange` callback is invoked synchronously on every value
 *      transition (set + auto-clear). Subscribers store this in React state.
 *
 * The hook's previous inline implementation owned its `useState` AND its
 * timer ref AND its setter, all coupled to React. By splitting them, the
 * timer logic is now a 30-line pure module that any non-React surface
 * (tests, future workers, native bridges) can use.
 */

export interface AutoClearController<T> {
  /** Most recent value, or null if cleared / never set. */
  get(): T | null;
  /**
   * Store a new value. If non-null, schedules a one-shot auto-clear after
   * `durationMs`. Cancels any previously-scheduled clear so timers never
   * stack across rapid calls.
   *
   * Calling `set` after `dispose` is a no-op — keeps a late external caller
   * from racing a torn-down timer.
   */
  set(next: T | null): void;
  /**
   * Cancel any pending auto-clear timer without changing the value or
   * notifying the subscriber. Idempotent; safe to call multiple times.
   * The hook's useEffect cleanup uses this on unmount.
   */
  dispose(): void;
  /** True after `dispose()` — `set()` is a no-op. Exposed for tests. */
  isDisposed(): boolean;
}

/** Subscriber callback fired on every value transition (set + auto-clear). */
export type AutoClearListener<T> = (value: T | null) => void;

/**
 * Build a fresh controller. The `durationMs` is captured once at construction
 * — the hook re-creates the controller if the duration prop changes, which
 * matches the existing useAutoClearFlag deps. `onChange` is the synchronous
 * notification hook for the consumer (the React hook stores it in setState).
 *
 * The two scheduling primitives are passed in so tests can swap them out
 * with `jest.useFakeTimers()` without monkey-patching globals: pass
 * `setTimeout` / `clearTimeout` from the React hook side, and Jest's fake
 * implementations from tests.
 */
export function createAutoClearController<T>(
  durationMs: number,
  onChange: AutoClearListener<T>,
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout,
): AutoClearController<T> {
  let value: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };

  return {
    get(): T | null {
      return value;
    },
    set(next: T | null): void {
      if (disposed) return;
      clearTimer();
      value = next;
      onChange(value);
      if (next !== null) {
        timer = schedule(() => {
          // The auto-clear path also notifies subscribers and clears the
          // timer slot so a subsequent `set(null)` after auto-clear isn't
          // a redundant cancel().
          timer = null;
          value = null;
          onChange(null);
        }, durationMs);
      }
    },
    dispose(): void {
      clearTimer();
      disposed = true;
    },
    isDisposed(): boolean {
      return disposed;
    },
  };
}
