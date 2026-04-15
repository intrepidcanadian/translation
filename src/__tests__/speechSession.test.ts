/**
 * @jest-environment node
 */

// Mock expo-speech first — Speech.stop() is the defensive teardown call.
const mockSpeechStop = jest.fn();
jest.mock("expo-speech", () => ({
  stop: () => mockSpeechStop(),
}));

// Mock expo-speech-recognition. We export the same enum constants as the
// real module so the helper can reference AVAudioSessionCategory.playAndRecord
// without crashing on undefined lookups, but the values are opaque strings
// that we just pattern-match in the test assertions.
const mockStart = jest.fn();
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    start: (opts: unknown) => mockStart(opts),
  },
  AVAudioSessionCategory: {
    playAndRecord: "playAndRecord",
    record: "record",
    playback: "playback",
  },
  AVAudioSessionCategoryOptions: {
    defaultToSpeaker: "defaultToSpeaker",
    allowBluetooth: "allowBluetooth",
    duckOthers: "duckOthers",
  },
  AVAudioSessionMode: {
    measurement: "measurement",
    default: "default",
  },
}));

const mockLoggerWarn = jest.fn();
jest.mock("../services/logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { startSpeechSession } from "../utils/speechSession";

beforeEach(() => {
  mockSpeechStop.mockReset();
  mockStart.mockReset();
  mockLoggerWarn.mockReset();
});

describe("startSpeechSession", () => {
  it("calls Speech.stop() before ExpoSpeechRecognitionModule.start()", () => {
    mockSpeechStop.mockReturnValue(undefined);
    const order: string[] = [];
    mockSpeechStop.mockImplementationOnce(() => {
      order.push("stop");
      return undefined;
    });
    mockStart.mockImplementationOnce(() => {
      order.push("start");
    });

    startSpeechSession({ lang: "en-US", interimResults: true, continuous: true });

    expect(order).toEqual(["stop", "start"]);
  });

  it("forwards user options to ExpoSpeechRecognitionModule.start()", () => {
    mockSpeechStop.mockReturnValue(undefined);
    startSpeechSession({
      lang: "es-ES",
      interimResults: false,
      continuous: false,
      requiresOnDeviceRecognition: true,
    });

    expect(mockStart).toHaveBeenCalledTimes(1);
    const opts = mockStart.mock.calls[0][0];
    expect(opts.lang).toBe("es-ES");
    expect(opts.interimResults).toBe(false);
    expect(opts.continuous).toBe(false);
    expect(opts.requiresOnDeviceRecognition).toBe(true);
  });

  it("pins iOS audio category to playAndRecord/measurement when caller doesn't override", () => {
    mockSpeechStop.mockReturnValue(undefined);
    startSpeechSession({ lang: "en-US", interimResults: true, continuous: true });

    const opts = mockStart.mock.calls[0][0];
    expect(opts.iosCategory).toBeDefined();
    expect(opts.iosCategory.category).toBe("playAndRecord");
    expect(opts.iosCategory.mode).toBe("measurement");
    expect(opts.iosCategory.categoryOptions).toEqual(
      expect.arrayContaining(["defaultToSpeaker", "allowBluetooth", "duckOthers"])
    );
  });

  it("respects a caller-supplied iosCategory instead of clobbering it", () => {
    mockSpeechStop.mockReturnValue(undefined);
    const customCategory = {
      category: "record",
      categoryOptions: ["allowBluetooth"],
      mode: "default",
    };
    // The helper accepts ExpoSpeechRecognitionOptions; we use `as any` here
    // because the exported type isn't trivially constructable from the mock.
    startSpeechSession({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iosCategory: customCategory as any,
    });

    const opts = mockStart.mock.calls[0][0];
    expect(opts.iosCategory).toBe(customCategory);
  });

  it("swallows a synchronous Speech.stop() throw and still calls start()", () => {
    mockSpeechStop.mockImplementationOnce(() => {
      throw new Error("native module not linked");
    });

    expect(() =>
      startSpeechSession({ lang: "en-US", interimResults: true, continuous: true })
    ).not.toThrow();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Speech",
      "Speech.stop() threw before mic acquire",
      expect.any(Error)
    );
  });

  it("swallows a rejected Speech.stop() promise instead of leaking unhandled rejection", async () => {
    // The bug fix: Speech.stop() returns Promise<void>; a sync try/catch
    // would NOT catch a rejected promise. The helper must chain .catch().
    const rejection = new Error("native rejection");
    mockSpeechStop.mockImplementationOnce(() => Promise.reject(rejection));

    expect(() =>
      startSpeechSession({ lang: "en-US", interimResults: true, continuous: true })
    ).not.toThrow();

    // start() still ran (we don't gate on TTS teardown completion)
    expect(mockStart).toHaveBeenCalledTimes(1);

    // Drain microtasks so the .catch() runs and calls logger.warn
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Speech",
      "Speech.stop() rejected before mic acquire",
      rejection
    );
  });

  it("handles Speech.stop() returning a non-thenable without crashing", () => {
    // Some platforms / older expo-speech versions return undefined sync.
    mockSpeechStop.mockReturnValue(undefined);

    expect(() =>
      startSpeechSession({ lang: "en-US", interimResults: true, continuous: true })
    ).not.toThrow();

    expect(mockStart).toHaveBeenCalledTimes(1);
    // No logger.warn for the success path
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});
