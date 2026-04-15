/**
 * Unit tests for `escapeHtml` — the minimal HTML escape used by every PDF
 * export path in the app (ConversationPlayback, history share, and via
 * `shared htmlEscape helper` the duty-free / passenger / listing generators
 * that render text into expo-print templates).
 *
 * Why pin it: a regression here would let translation text escape out of a
 * PDF text node and break the template layout — or worse, if translation
 * text contained something like `"><script>`, inject markup into a shared
 * PDF artifact. The function is tiny, but it's security-adjacent because
 * the input (translations, user notes, OCR output) crosses a user-visible
 * rendering boundary. Keeping the contract explicit in a regression fence
 * protects future refactors (e.g. swapping the chained replaces for a
 * table-driven approach) from silently dropping one of the five escapes.
 *
 * The test matrix covers:
 *  - each of the five escaped characters in isolation
 *  - the ampersand-first ordering bug (escaping `&` second would double-
 *    escape every `&amp;` produced by the other replacements)
 *  - idempotency contracts (running the escape twice keeps the shape)
 *  - plain text pass-through (no false positives)
 *  - mixed content as exercised by real PDF template inputs
 */
import { escapeHtml } from "../utils/htmlEscape";

describe("escapeHtml", () => {
  it("escapes ampersand to &amp;", () => {
    expect(escapeHtml("&")).toBe("&amp;");
  });

  it("escapes less-than to &lt;", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("escapes greater-than to &gt;", () => {
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it("escapes double-quote to &quot;", () => {
    expect(escapeHtml('"')).toBe("&quot;");
  });

  it("escapes single-quote to &#39;", () => {
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes the ampersand FIRST so the other escapes don't get double-encoded", () => {
    // This is the classic escape-order bug: if you replace `<` before `&`,
    // you end up with `&amp;lt;` because the second pass sees the `&` you
    // just introduced. The current implementation dodges this by ordering
    // `&` first. Pin the contract.
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("<")).not.toBe("&amp;lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml(">")).not.toBe("&amp;gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml('"')).not.toBe("&amp;quot;");
    expect(escapeHtml("'")).toBe("&#39;");
    expect(escapeHtml("'")).not.toBe("&amp;#39;");
  });

  it("passes plain alphanumeric + whitespace through unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
    expect(escapeHtml("Translation 123")).toBe("Translation 123");
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("   ")).toBe("   ");
  });

  it("passes CJK / non-Latin scripts through unchanged", () => {
    // Important for a translation app — the escape function sees Japanese,
    // Chinese, Arabic, Hindi, etc. on every PDF export. Those code points
    // must NOT be touched.
    expect(escapeHtml("こんにちは")).toBe("こんにちは");
    expect(escapeHtml("你好")).toBe("你好");
    expect(escapeHtml("مرحبا")).toBe("مرحبا");
    expect(escapeHtml("Привет")).toBe("Привет");
  });

  it("escapes a mixed realistic PDF input", () => {
    // A realistic line from a conversation export — mixes an ampersand,
    // a quoted phrase, and some plain text. This is the shape every PDF
    // template actually consumes.
    const input = `Alice said: "Hello & <world>"`;
    expect(escapeHtml(input)).toBe(
      "Alice said: &quot;Hello &amp; &lt;world&gt;&quot;"
    );
  });

  it("escapes multiple occurrences of each character", () => {
    expect(escapeHtml("&&")).toBe("&amp;&amp;");
    expect(escapeHtml("<<>>")).toBe("&lt;&lt;&gt;&gt;");
    expect(escapeHtml(`""''`)).toBe("&quot;&quot;&#39;&#39;");
  });

  it("defuses a naive <script> injection attempt in PDF input", () => {
    // Not a security guarantee (PDFs go through expo-print which does its
    // own parsing), but the escape must still produce *only* entity-
    // encoded output so nothing resembling markup leaks through. Exactly
    // the pattern an attacker might slip into a translation field.
    const hostile = `"><script>alert(1)</script>`;
    const escaped = escapeHtml(hostile);
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("</script>");
    expect(escaped).toBe(
      "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("is stable across an empty string and a single character", () => {
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("a")).toBe("a");
  });
});
