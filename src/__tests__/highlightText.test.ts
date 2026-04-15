/**
 * Unit tests for `highlightMatches` — the search-result highlighter used by
 * TranslationBubble + ChatBubble + history search to wrap a query inside a
 * larger string with a styled <Text> node.
 *
 * Why pin it: the implementation looks trivial but contains a load-bearing
 * subtlety. It uses `String.split(/(query)/gi)` (capture group) and relies on
 * the invariant that `split` puts captured matches at ODD indices and non-
 * match text at EVEN indices. The previous implementation mapped over the
 * parts and called `regex.test(part)` to decide which were matches — that
 * looks fine in isolation but the global regex's `lastIndex` is stateful, so
 * `.test()` mutates between iterations and can return the wrong answer for
 * the same input. Run 18 reworked it to use index parity instead, which is
 * both correct and ~2× faster (no per-segment regex execution).
 *
 * The test matrix locks down:
 *  - empty query → returns the full string, untouched (no slicing)
 *  - basic single match → 3 nodes (before / match / after)
 *  - multiple matches → alternating non-match / match / non-match (parity)
 *  - case-insensitive matching against differently-cased text
 *  - regex-special characters in the query are escaped, not interpreted
 *  - no match → entire text is rendered as a single non-match node
 *  - whitespace-only query is treated as empty (no highlight)
 *  - leading + trailing matches still produce correct empty-string siblings
 *    at the parity-required positions (the React layer skips empty <Text>s
 *    visually but the array shape is the contract)
 */
import React from "react";
import { highlightMatches } from "../utils/highlightText";

// Pull a string of text out of a <Text> ReactElement for assertions. The
// implementation always wraps each segment in a <Text> with a string child,
// so `props.children` is exactly the segment text.
function text(node: React.ReactNode): string {
  if (node && typeof node === "object" && "props" in node) {
    const child = (node as React.ReactElement<{ children: string }>).props.children;
    return typeof child === "string" ? child : "";
  }
  return "";
}

// Read the resolved style array on a node. highlightMatches passes a flat
// `baseStyle` for non-matches and `[baseStyle, highlightStyle]` for matches,
// so the array's length distinguishes the two cases.
function isHighlighted(node: React.ReactNode): boolean {
  if (!node || typeof node !== "object" || !("props" in node)) return false;
  const style = (node as React.ReactElement<{ style: unknown }>).props.style;
  return Array.isArray(style) && style.length === 2;
}

const base = { color: "black" };
const hl = { backgroundColor: "yellow" };

describe("highlightMatches", () => {
  it("returns the full string in a single non-highlighted node when query is empty", () => {
    const out = highlightMatches("hello world", "", base, hl);
    expect(out).toHaveLength(1);
    expect(text(out[0])).toBe("hello world");
    expect(isHighlighted(out[0])).toBe(false);
  });

  it("treats a whitespace-only query as empty", () => {
    // Trim guard: `"   ".trim()` is "", so highlightMatches must early-out.
    // Otherwise we'd build a regex for whitespace and produce surprise hits
    // on every space in the string.
    const out = highlightMatches("hello world", "   ", base, hl);
    expect(out).toHaveLength(1);
    expect(text(out[0])).toBe("hello world");
    expect(isHighlighted(out[0])).toBe(false);
  });

  it("highlights a single match in the middle of the string", () => {
    const out = highlightMatches("hello world", "world", base, hl);
    // split("hello world", /(world)/gi) → ["hello ", "world", ""]
    expect(out).toHaveLength(3);
    expect(text(out[0])).toBe("hello ");
    expect(isHighlighted(out[0])).toBe(false);
    expect(text(out[1])).toBe("world");
    expect(isHighlighted(out[1])).toBe(true);
    expect(text(out[2])).toBe("");
    expect(isHighlighted(out[2])).toBe(false);
  });

  it("highlights multiple matches and alternates parity correctly", () => {
    // This is the regression case for the stateful-regex bug: with `.test()`
    // on the global regex, the second match could get mis-classified
    // depending on `lastIndex` carry-over between iterations. With index
    // parity, every odd index is unambiguously a match.
    const out = highlightMatches("foo bar foo baz foo", "foo", base, hl);
    expect(out.map(text)).toEqual(["", "foo", " bar ", "foo", " baz ", "foo", ""]);
    expect(out.map(isHighlighted)).toEqual([false, true, false, true, false, true, false]);
  });

  it("matches case-insensitively but preserves the original casing in output", () => {
    // The regex is built with the `i` flag, so the query "WORLD" matches
    // "World" — and the *captured* segment is the original casing from the
    // input string (capture groups in split() preserve source text), so the
    // user sees their actual text highlighted, not their query string.
    const out = highlightMatches("Hello World", "WORLD", base, hl);
    expect(out).toHaveLength(3);
    expect(text(out[1])).toBe("World");
    expect(isHighlighted(out[1])).toBe(true);
  });

  it("escapes regex-special characters in the query", () => {
    // The implementation runs the query through the standard regex-escape
    // before building the matcher. Without that, a user typing "a.c" would
    // match "abc" (the dot acting as wildcard). Pin the literal-match
    // contract because search inputs come straight from user typing.
    const out = highlightMatches("a.c abc", "a.c", base, hl);
    // Only the literal "a.c" (not "abc") should be highlighted.
    expect(out.map(text)).toEqual(["", "a.c", " abc"]);
    expect(out.map(isHighlighted)).toEqual([false, true, false]);
  });

  it("escapes other regex metacharacters in the query (parens, brackets, plus)", () => {
    // Locks the escape list — if a future refactor swaps the escape regex
    // and drops one of the metacharacters, this test catches the
    // false-match regression.
    const out1 = highlightMatches("price (USD)", "(USD)", base, hl);
    expect(out1.map(text)).toEqual(["price ", "(USD)", ""]);
    expect(out1.map(isHighlighted)).toEqual([false, true, false]);

    const out2 = highlightMatches("a+b = c", "a+b", base, hl);
    expect(out2.map(text)).toEqual(["", "a+b", " = c"]);
    expect(out2.map(isHighlighted)).toEqual([false, true, false]);

    const out3 = highlightMatches("path/to/file", "to/file", base, hl);
    expect(out3.map(text)).toEqual(["path/", "to/file", ""]);
  });

  it("returns the entire text as a single non-match node when the query is not present", () => {
    const out = highlightMatches("hello world", "xyz", base, hl);
    expect(out).toHaveLength(1);
    expect(text(out[0])).toBe("hello world");
    expect(isHighlighted(out[0])).toBe(false);
  });

  it("handles a match at the very start of the string", () => {
    const out = highlightMatches("hello world", "hello", base, hl);
    expect(out.map(text)).toEqual(["", "hello", " world"]);
    expect(out.map(isHighlighted)).toEqual([false, true, false]);
  });

  it("handles a match at the very end of the string", () => {
    const out = highlightMatches("hello world", "world", base, hl);
    expect(out.map(text)).toEqual(["hello ", "world", ""]);
    expect(out.map(isHighlighted)).toEqual([false, true, false]);
  });

  it("handles the entire string being a match", () => {
    const out = highlightMatches("foo", "foo", base, hl);
    expect(out.map(text)).toEqual(["", "foo", ""]);
    expect(out.map(isHighlighted)).toEqual([false, true, false]);
  });

  it("highlights CJK matches (the app is a translator — non-Latin queries are common)", () => {
    const out = highlightMatches("こんにちは世界", "世界", base, hl);
    expect(out.map(text)).toEqual(["こんにちは", "世界", ""]);
    expect(out.map(isHighlighted)).toEqual([false, true, false]);
  });

  it("assigns unique React keys to each segment so rendering doesn't warn", () => {
    // The keys are the index, so they're trivially unique. Pin it anyway
    // because dropping the key prop is an easy refactor mistake and React
    // warns at runtime — but only after the bad code has shipped.
    const out = highlightMatches("foo bar foo", "foo", base, hl);
    const keys = out.map((node) =>
      node && typeof node === "object" && "key" in node
        ? (node as React.ReactElement).key
        : null
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(out.length);
  });
});
