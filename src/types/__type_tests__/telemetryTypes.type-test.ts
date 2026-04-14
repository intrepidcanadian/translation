/**
 * Compile-time type tests for TelemetryKey (#144 / #157).
 *
 * Purely a type-level check: if `TelemetryKey` drifts away from the
 * `TypeAheadKey | SpeechKey` aggregate (e.g. someone adds a new `OcrKey`
 * union but forgets to fold it into `TelemetryKey`, or splits `SpeechKey`
 * and forgets to re-export one of the halves), this file fails to compile
 * and `tsc --noEmit` tripwires before the broken contract reaches runtime.
 *
 * #157 refactor: previously this lived under `src/__tests__/` next to
 * every real jest suite, which forced a dummy runtime `describe` block
 * just to keep jest's default test discovery happy. That shim carried no
 * real assertions — the entire contract runs at compile time via tsc.
 *
 * The new home is `src/types/__type_tests__/`, excluded from jest's
 * `testPathIgnorePatterns` in package.json. tsc still compiles the file
 * (tsconfig doesn't exclude it), so the type assertions still fire; jest
 * no longer tries to execute it, so the runtime fixture is gone.
 *
 * Why this exists: #124 split the flat TelemetryKey into per-feature
 * unions so adding a new namespace doesn't force every call site to
 * re-import a sprawling type. The aggregate that downstream consumers
 * (increment/get/getAll) actually use needs to stay in sync with the
 * parts — a regression here silently orphans counters.
 */
import type { TypeAheadKey, SpeechKey, TelemetryKey } from "../../services/telemetry";

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

// Reference the aliases so `noUnusedLocals` doesn't strip them out entirely —
// the assertion happens in the type parameter, not at runtime. Exporting the
// tuple makes the file a module (required for `import type` above) and keeps
// every Expect<...> in the type-check graph.
export type __TelemetryKeyTypeAssertions = [
  _TypeAheadIsSubset,
  _SpeechIsSubset,
  _AggregateIdentity,
  _HasTypeAheadGlossary,
  _HasSpeechNoSpeech,
  _HasSpeechFail,
  _NotAssignable,
];
