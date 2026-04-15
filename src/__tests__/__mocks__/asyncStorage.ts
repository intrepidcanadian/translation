/**
 * Shared AsyncStorage stub for jest test suites (#199 close-out).
 *
 * Many suites — currencyExchange, ocrPricePreprocess, and any future suite
 * that transitively pulls in telemetry (#122) — need to stub
 * `@react-native-async-storage/async-storage` because the native module isn't
 * available in the node test environment. The stub body was identical across
 * two suites and would have been copied into a third every time a new
 * pure-module test hit the transitive-import wall.
 *
 * Lifting the factory here does three things:
 *
 *   1. De-duplicates the six-line mock body across every test file that only
 *      needs stateless no-op AsyncStorage (reads always return `null`, writes
 *      always succeed). Adding a fourth suite is now a one-line import.
 *   2. Documents the default contract in one place. Suites that need real
 *      in-memory persistence (e.g. `telemetry.test.ts`) intentionally keep
 *      their own stateful stub — the getter there is used to assert hydration
 *      behavior, which the no-op stub can't reproduce. Those callsites are
 *      clearly distinguished from the "transitive import only" cases.
 *   3. Gives us a single choke point for future tweaks. If a future test
 *      needs to observe writes without stateful storage (e.g. asserting a
 *      debounced persist fired exactly once), we can extend this factory
 *      with a `spy` mode instead of hand-rolling another copy.
 *
 * Usage:
 *
 *   jest.mock(
 *     "@react-native-async-storage/async-storage",
 *     () => require("./__mocks__/asyncStorage").asyncStorageMockFactory()
 *   );
 *
 * The factory pattern (rather than a static object) keeps the jest.fn
 * instances per-suite so `.mock.calls` assertions in one suite don't pollute
 * another. Jest's module registry isolates modules across test files, so a
 * module-level `const mock = { ... }` would still be fresh per suite, but the
 * factory form also lets future callers pass overrides without reaching into
 * a shared singleton.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type AsyncStorageNoopMock = {
  __esModule: true;
  default: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
    multiGet: (keys: string[]) => Promise<Array<[string, string | null]>>;
    multiSet: (pairs: Array<[string, string]>) => Promise<void>;
    clear: () => Promise<void>;
  };
};

/**
 * Return a fresh no-op AsyncStorage mock object. All reads resolve to `null`,
 * all writes resolve to `undefined`. Suitable for suites that only need the
 * native module to exist at import time and never actually interact with
 * persisted state (the overwhelming common case for pure-utility tests that
 * transitively import telemetry or any other storage-using service).
 */
export function asyncStorageMockFactory(): AsyncStorageNoopMock {
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
      removeItem: jest.fn(async () => undefined),
      multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, null] as [string, null])),
      multiSet: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
    },
  };
}
