/**
 * Apple Foundation Models (on-device LLM) bridge (#222).
 *
 * Thin wrapper around the iOS 26+ / "Apple Intelligence" FoundationModels
 * framework. Exposes a single `complete` function that sends a prompt to
 * the on-device ~3B-parameter model and returns the response text.
 *
 * This is the right tool for *latency-tolerant, one-shot, structured-
 * extraction* tasks — things like:
 *   - "Given this receipt, which item costs the most?"
 *   - "Summarize this paragraph in one sentence."
 *   - "Extract every date from this note."
 *
 * It is NOT the right tool for:
 *   - Real-time speech translation (200–800ms latency per call would burn
 *     a full conversation turn budget in one prompt).
 *   - Per-frame camera work (battery cost dominates; use the deterministic
 *     regex path in `currencyExchange.ts` instead).
 *   - Anything that needs cross-device consistency (the LLM output isn't
 *     reproducible even with the same input; determinism matters for
 *     testable price conversion).
 *
 * Availability rules:
 *   - iOS 26.0+ (Apple Intelligence era; Foundation Models framework
 *     shipped with iOS 26). Older OSes return `false` from `isAvailable()`.
 *   - Device must support Apple Intelligence (iPhone 15 Pro or later,
 *     M1+ iPads, Apple Silicon Macs). `isAvailable()` reflects this.
 *   - User must have enabled Apple Intelligence in Settings. Matches the
 *     framework's own `SystemLanguageModel.default.availability` check.
 *
 * Every caller MUST `await isAvailable()` before calling `complete`;
 * calling `complete` on an unavailable device throws a native error that
 * the TS wrapper doesn't try to recover from. The `receiptAssistant`
 * service in `src/services/receiptAssistant.ts` is the canonical consumer
 * and demonstrates the availability-check-then-call pattern plus the
 * fallback routing to the rules engine when unavailable.
 *
 * Native-side compile note:
 *   - The Swift implementation uses `#if canImport(FoundationModels)`
 *     guards so the module still compiles on older Xcode / older iOS
 *     deployment targets. Older builds see `isAvailable()` return `false`
 *     and every other method throw.
 *   - Requires Xcode 16+ and the iOS 26 SDK to actually exercise the
 *     Foundation Models path at runtime. Earlier SDKs compile the
 *     fallback branch and always report unavailable.
 */

import { requireNativeModule, Platform } from "expo-modules-core";

export interface CompleteOptions {
  /** Maximum tokens to generate. Defaults to 512, capped at 2048. */
  maxTokens?: number;
  /** Sampling temperature 0–1; 0 = greedy, deterministic-ish. Defaults to 0.2
   *  because receipt Q&A wants low-variance factual answers, not creative
   *  generation. */
  temperature?: number;
  /** Optional system instruction prepended to the prompt. Keep it terse —
   *  the 3B model is easily distracted by long system preambles. */
  system?: string;
}

interface AppleFoundationModelsModuleType {
  isAvailable(): Promise<boolean>;
  /** Device-capability status, independent of user preference. Useful for a
   *  settings screen that wants to distinguish "your iPhone can't run this"
   *  from "you haven't enabled Apple Intelligence". */
  getAvailabilityStatus(): Promise<
    "available" | "unsupportedDevice" | "notEnabled" | "modelNotReady"
  >;
  complete(prompt: string, options: CompleteOptions): Promise<string>;
}

const isIOS = Platform.OS === "ios";
let nativeModule: AppleFoundationModelsModuleType | undefined;

function tryLoadModule(): AppleFoundationModelsModuleType | null {
  if (!isIOS) return null;
  if (nativeModule) return nativeModule;
  try {
    nativeModule = requireNativeModule(
      "AppleFoundationModels"
    ) as AppleFoundationModelsModuleType;
    return nativeModule;
  } catch {
    // Module not linked (Expo Go, older prebuild, missing native binary).
    // Callers treat this as "unavailable" — same as a real runtime false.
    return null;
  }
}

/**
 * True iff the on-device LLM can be invoked right now. Returns false on
 * non-iOS, on iOS < 26, on unsupported devices, when Apple Intelligence
 * is disabled in Settings, and when the native module isn't linked
 * (Expo Go, fresh prebuild without `expo prebuild --clean`, etc).
 *
 * Cached result: because this touches native code and the value only
 * changes in response to user settings or app restart, callers are
 * encouraged to cache the resolved boolean in their own state rather
 * than re-invoking per question.
 */
export async function isAvailable(): Promise<boolean> {
  const mod = tryLoadModule();
  if (!mod) return false;
  try {
    return await mod.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Fine-grained availability status for the Settings UI. `"available"` means
 * `complete()` will work; the other three values are all reasons the UI
 * should surface a different hint ("enable Apple Intelligence", "upgrade
 * device", "model is downloading, try later"). Collapses to `"notEnabled"`
 * on non-iOS so Android/web users see a coherent message.
 */
export async function getAvailabilityStatus(): Promise<
  "available" | "unsupportedDevice" | "notEnabled" | "modelNotReady"
> {
  const mod = tryLoadModule();
  if (!mod) return "notEnabled";
  try {
    return await mod.getAvailabilityStatus();
  } catch {
    return "notEnabled";
  }
}

/**
 * Send a prompt to the on-device LLM. Throws if the model is unavailable;
 * always gate with `isAvailable()` first. Options are forwarded directly to
 * the native side with clamped defaults — `maxTokens` caps at 2048 to
 * prevent runaway generation.
 */
export async function complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
  const mod = tryLoadModule();
  if (!mod) {
    throw new Error("Apple Foundation Models unavailable on this device");
  }
  const clamped: CompleteOptions = {
    maxTokens: Math.min(Math.max(options.maxTokens ?? 512, 1), 2048),
    temperature: Math.min(Math.max(options.temperature ?? 0.2, 0), 1),
    system: options.system,
  };
  return mod.complete(prompt, clamped);
}
