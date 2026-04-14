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
import { copyWithAutoClear, cancelClipboardAutoClear } from "../services/clipboard";

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
