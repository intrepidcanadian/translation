/**
 * Compile-time type tests for TelemetryKey (#144).
 *
 * Purely a type-level check: if `TelemetryKey` drifts away from the
 * `TypeAheadKey | SpeechKey` aggregate (e.g. someone adds a new `OcrKey`
 * union but forgets to fold it into `TelemetryKey`, or splits `SpeechKey`
 * and forgets to re-export one of the halves), this file fails to compile
 * and `tsc --noEmit` tripwires before the broken contract reaches runtime.
 *
 * Runs under `tsc` via the same compile step as every other .ts file; the
 * `.test-d.ts` suffix signals "type-level test" and is ignored by jest's
 * test discovery so it doesn't try to execute runtime assertions.
 *
 * Why this exists: #124 split the flat TelemetryKey into per-feature
 * unions so adding a new namespace doesn't force every call site to
 * re-import a sprawling type. The aggregate that downstream consumers
 * (increment/get/getAll) actually use needs to stay in sync with the
 * parts — a regression here silently orphans counters.
 */
import type { TypeAheadKey, SpeechKey, TelemetryKey } from "../services/telemetry";

// ---------- Helpers ---------------------------------------------------------

/** Compile-time equality check. Resolves to `true` iff T and U are mutually
 *  assignable, `false` otherwise. Used to freeze union identity. */
type Equals<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

/** Assert that a type evaluates to literal `true`. Fails compilation
 *  otherwise, which is exactly what we want for a type-level test. */
type Expect<T extends true> = T;

// ---------- Tests -----------------------------------------------------------

// 1. Every TypeAheadKey must be assignable to TelemetryKey.
type _TypeAheadIsSubset = Expect<Equals<TypeAheadKey extends TelemetryKey ? true : false, true>>;

// 2. Every SpeechKey must be assignable to TelemetryKey.
type _SpeechIsSubset = Expect<Equals<SpeechKey extends TelemetryKey ? true : false, true>>;

// 3. The aggregate must be exactly the union of the parts — no extras, no
//    missing members. If a new namespace is added (e.g. OcrKey), this line
//    starts failing and forces the maintainer to update TelemetryKey and
//    this test in the same commit.
type _AggregateIdentity = Expect<Equals<TelemetryKey, TypeAheadKey | SpeechKey>>;

// 4. Spot-check that specific known literals remain in the aggregate. If
//    someone accidentally drops `speech.noSpeech` from SpeechKey, this
//    line stops compiling. (#152 added this key; #154/#144 pin it.)
type _HasTypeAheadGlossary = Expect<"typeAhead.glossary" extends TelemetryKey ? true : false>;
type _HasSpeechNoSpeech = Expect<"speech.noSpeech" extends TelemetryKey ? true : false>;
type _HasSpeechFail = Expect<"speech.translateFail" extends TelemetryKey ? true : false>;

// 5. Negative check: an unknown literal must NOT be assignable. TypeScript
//    doesn't have a direct "not assignable" assert, so we invert Equals on a
//    `false`-resolving predicate.
type _NotAssignable = Expect<
  Equals<"ocr.frameProcessed" extends TelemetryKey ? true : false, false>
>;

// Reference the types so `noUnusedLocals` doesn't strip them out entirely —
// the assertion happens in the type parameter, not at runtime.
type __TelemetryKeyTypeAssertions = [
  _TypeAheadIsSubset,
  _SpeechIsSubset,
  _AggregateIdentity,
  _HasTypeAheadGlossary,
  _HasSpeechNoSpeech,
  _HasSpeechFail,
  _NotAssignable,
];

// Jest's default testMatch picks up any .ts file under __tests__/ and will
// fail the run if no runtime tests are defined. The real assertions above
// happen at compile time via `tsc --noEmit`, so we add a single trivial
// runtime check to keep jest happy without duplicating the type contract.
describe("TelemetryKey aggregate type (#144)", () => {
  it("compile-time assertions evaluated by tsc --noEmit", () => {
    const fixture: __TelemetryKeyTypeAssertions = [true, true, true, true, true, true, true];
    // Each entry is the literal `true` from a passing `Expect<...>` alias.
    // A single runtime sanity check ensures the fixture ref is exercised.
    expect(fixture.every((v) => v === true)).toBe(true);
  });
});
