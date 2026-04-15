/**
 * @jest-environment node
 *
 * Unit tests for `createAutoClearController` — the pure timer state machine
 * that backs `useAutoClearFlag` (#185). The hook is a thin React adapter on
 * top of this controller; testing the controller in isolation is the closest
 * we can get to pinning the unmount-cleanup contract without React testing
 * infrastructure (which #111 still hasn't delivered).
 *
 * The contract under test:
 *
 *   1. `set(value)` schedules a one-shot clear after `durationMs` and
 *      notifies the listener with the new value.
 *   2. A second `set(value)` cancels the pending clear before scheduling
 *      a fresh one — timers don't stack and the previous clear can't race
 *      past the new value.
 *   3. `set(null)` cancels any pending clear and notifies with null.
 *   4. After `dispose()`, `set` becomes a no-op AND any pending timer
 *      stays cancelled — this is the "unmount during pending auto-clear"
 *      regression scenario the hook exists to prevent.
 *   5. The auto-clear path notifies the listener exactly once per timer
 *      fire — duplicate notifications would cause double-renders in the
 *      hook consumer.
 *
 * Uses Jest fake timers so we can advance the clock deterministically
 * without sleeping. The controller takes its `schedule` / `cancel` callbacks
 * as constructor arguments specifically so tests can pass `setTimeout` /
 * `clearTimeout` after `jest.useFakeTimers()` has installed the fakes,
 * without monkey-patching globals or wrestling with promise microtasks.
 */
import { createAutoClearController } from "../utils/autoClearController";

describe("createAutoClearController", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("set(value) stores value and notifies listener", () => {
    const calls: Array<string | null> = [];
    const c = createAutoClearController<string>(1500, (v) => calls.push(v));
    c.set("hello");
    expect(c.get()).toBe("hello");
    expect(calls).toEqual(["hello"]);
  });

  test("auto-clears to null after durationMs", () => {
    const calls: Array<string | null> = [];
    const c = createAutoClearController<string>(1500, (v) => calls.push(v));
    c.set("hi");
    expect(c.get()).toBe("hi");
    jest.advanceTimersByTime(1499);
    // Just before the boundary — still set.
    expect(c.get()).toBe("hi");
    jest.advanceTimersByTime(1);
    // Auto-clear has fired.
    expect(c.get()).toBeNull();
    expect(calls).toEqual(["hi", null]);
  });

  test("rapid set calls cancel the previous timer instead of stacking", () => {
    // The bug this prevents: a user double-taps "Copy" within the badge
    // window. Without cancellation, the first timer would still fire and
    // wipe the second value 1500ms after the FIRST tap, not the second —
    // the badge would disappear early.
    const calls: Array<string | null> = [];
    const c = createAutoClearController<string>(1500, (v) => calls.push(v));
    c.set("first");
    jest.advanceTimersByTime(1000);
    c.set("second");
    // The first auto-clear must NOT fire 500ms later (which is when it
    // would land if we hadn't cancelled it).
    jest.advanceTimersByTime(500);
    expect(c.get()).toBe("second");
    // Run another 1000ms to land on second's natural expiry (1500ms after
    // the second set). Now it should clear.
    jest.advanceTimersByTime(1000);
    expect(c.get()).toBeNull();
    // Listener saw: first set, second set, second auto-clear. The first
    // auto-clear was cancelled and never fired.
    expect(calls).toEqual(["first", "second", null]);
  });

  test("set(null) cancels pending timer and notifies immediately", () => {
    const calls: Array<string | null> = [];
    const c = createAutoClearController<string>(1500, (v) => calls.push(v));
    c.set("transient");
    c.set(null);
    expect(c.get()).toBeNull();
    expect(calls).toEqual(["transient", null]);
    // Advance well past durationMs — no extra notification, the cancelled
    // timer must not fire.
    jest.advanceTimersByTime(5000);
    expect(calls).toEqual(["transient", null]);
  });

  test("dispose() cancels pending timer without notifying", () => {
    // The unmount-cleanup contract — this is the regression `useAutoClearFlag`
    // exists to prevent. A late timer fire after unmount would call setState
    // on a torn-down React tree (the original bug across 8 callsites).
    const calls: Array<string | null> = [];
    const c = createAutoClearController<string>(1500, (v) => calls.push(v));
    c.set("about-to-unmount");
    c.dispose();
    // Listener saw the set, but NOT a clear — dispose is silent so the
    // (now-unmounted) consumer doesn't fire an extra setState.
    expect(calls).toEqual(["about-to-unmount"]);
    jest.advanceTimersByTime(5000);
    // Still only the original notification — the timer was cancelled.
    expect(calls).toEqual(["about-to-unmount"]);
    expect(c.isDisposed()).toBe(true);
  });

  test("set() after dispose is a no-op", () => {
    // A delayed external caller (e.g. an async callback that resolves after
    // the component has unmounted) must not be able to resurrect the
    // controller and schedule a new timer.
    const calls: Array<string | null> = [];
    const c = createAutoClearController<string>(1500, (v) => calls.push(v));
    c.dispose();
    c.set("post-dispose");
    expect(c.get()).toBeNull();
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(5000);
    expect(calls).toEqual([]);
  });

  test("dispose is idempotent", () => {
    // Defensive: React's strict mode can run cleanup twice in dev. The
    // second dispose call must not throw or re-cancel a phantom timer.
    const c = createAutoClearController<string>(1500, () => {});
    c.set("x");
    c.dispose();
    expect(() => c.dispose()).not.toThrow();
    expect(c.isDisposed()).toBe(true);
  });

  test("works with non-string value types", () => {
    // The hook is used for both `<string>` (copied text) and `<true>` flags
    // (the SettingsModal `crashCopied` callsite). Make sure the controller
    // is properly generic — a regression where the type parameter leaks
    // would surface here.
    const calls: Array<true | null> = [];
    const c = createAutoClearController<true>(1500, (v) => calls.push(v));
    c.set(true);
    expect(c.get()).toBe(true);
    jest.advanceTimersByTime(1500);
    expect(c.get()).toBeNull();
    expect(calls).toEqual([true, null]);
  });
});
