/**
 * @jest-environment node
 */
jest.mock("expo-clipboard", () => {
  const state = { value: "" };
  return {
    __state: state,
    setStringAsync: jest.fn(async (s: string) => {
      state.value = s;
    }),
    getStringAsync: jest.fn(async () => state.value),
  };
});

jest.mock("../services/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import * as Clipboard from "expo-clipboard";
import {
  copyWithAutoClear,
  cancelClipboardAutoClear,
  copyWithoutAutoClear,
} from "../services/clipboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = (Clipboard as any).__state as { value: string };

async function flushMicrotasks() {
  // Drain the promise chain used by the auto-clear callback
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("clipboard auto-clear", () => {
  beforeEach(() => {
    store.value = "";
    cancelClipboardAutoClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("copies text immediately", async () => {
    await copyWithAutoClear("hello", 1000);
    expect(store.value).toBe("hello");
  });

  test("clears clipboard after TTL when content unchanged", async () => {
    await copyWithAutoClear("secret", 500);
    expect(store.value).toBe("secret");
    jest.advanceTimersByTime(600);
    await flushMicrotasks();
    expect(store.value).toBe("");
  });

  test("does not clear clipboard if user overwrote it", async () => {
    await copyWithAutoClear("ours", 500);
    store.value = "user typed something else";
    jest.advanceTimersByTime(600);
    await flushMicrotasks();
    expect(store.value).toBe("user typed something else");
  });

  test("cancelClipboardAutoClear prevents clearing", async () => {
    await copyWithAutoClear("keep", 500);
    cancelClipboardAutoClear();
    jest.advanceTimersByTime(600);
    await flushMicrotasks();
    expect(store.value).toBe("keep");
  });
});

// #155: explicit debug copy path — bypasses auto-clear AND cancels any
// pending auto-clear from a prior user-content copy, so the new debug
// content isn't wiped out mid-paste by an earlier timer.
describe("copyWithoutAutoClear", () => {
  beforeEach(() => {
    store.value = "";
    cancelClipboardAutoClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("copies text immediately like the auto-clear path", async () => {
    await copyWithoutAutoClear("crash-report-v1");
    expect(store.value).toBe("crash-report-v1");
  });

  test("does not schedule a timer — content survives past the default TTL", async () => {
    await copyWithoutAutoClear("debug-metadata");
    // 120s is well past the 60s default auto-clear window.
    jest.advanceTimersByTime(120_000);
    await flushMicrotasks();
    expect(store.value).toBe("debug-metadata");
  });

  test("cancels a pending auto-clear from a prior copyWithAutoClear call", async () => {
    await copyWithAutoClear("sensitive-translation", 500);
    expect(store.value).toBe("sensitive-translation");
    // User immediately copies a crash report before the 500ms timer fires.
    await copyWithoutAutoClear("crash-report");
    expect(store.value).toBe("crash-report");
    // The original timer would have cleared at 500ms. Advance past it and
    // confirm the debug copy is still there — the timer must have been
    // cancelled, not allowed to wipe the new content.
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(store.value).toBe("crash-report");
  });
});
