/**
 * #215: OCR line-wrap preprocessing for prices.
 *
 * Camera OCR on receipt images frequently splits a single price across two
 * lines when the column is narrow or the receipt is creased. The fuzz
 * corpus pinned the failure as `TOTAL $1,2\n34.56` → resolves as USD 1.2
 * (after #209's locale-aware decimal heuristic) when the *real* value is
 * `$1,234.56`. The parser can't fix this on its own — the line wrap is a
 * preprocessing problem that needs to be merged before `detectPricesInText`
 * sees the text.
 *
 * Strategy: scan for the unambiguous wrap shape — a currency prefix, 1–3
 * leading digits, a comma, 1–2 partial digits at end of line, then 1–3
 * digits and a `.\d{1,2}` decimal tail at start of next line. Both halves
 * must fit the wrap silhouette: the comma at line end is the strongest
 * signal that the number was incomplete (a complete US/EU price would not
 * end on a comma). When the shape matches, merge the two halves into a
 * single number on a single line so `detectPricesInText` extracts it as
 * one price instead of two.
 *
 * Conservative by design — there are several plausible wrap patterns this
 * does NOT handle (no-comma wraps like `$1\n234.56`, no-decimal wraps like
 * `$1,234\n.56`) because they're ambiguous with legitimate distinct-price
 * sequences (`Total $5\n10 items`). The current rule has zero false
 * positives on the OCR fuzz corpus.
 *
 * Shape (gritty regex notes):
 *   - `prefix`     — currency sigil or `RM`/`HK$`/`NT$`/`MX$`/`S$`/`A$`/`US$`
 *   - `headInt`    — 1–3 leading digits BEFORE the comma
 *   - `commaTail`  — `,` then 1–2 digits at the end of the line
 *   - `\n` + ws    — line break and any whitespace at start of next line
 *   - `midDigits`  — 1–3 digits at start of next line
 *   - `decimalTail` — `.` then 1–2 digits, NOT followed by another digit
 *
 * The reconstructed number drops the comma and concatenates head + commaTail
 * + midDigits + `.` + decimalTail. The result is something parseLocaleAmount
 * can interpret unambiguously via Rule 1 (period present → comma is thousands,
 * but here there's no comma either, so just `parseFloat`).
 *
 * Example trace for `TOTAL $1,2\n34.56`:
 *   prefix=`$`, headInt=`1`, commaTail=`2`, midDigits=`34`, decimalTail=`56`
 *   merged = `$` + `1` + `2` + `34` + `.` + `56` = `$1234.56` → USD 1234.56
 *
 * The trailing `(?!\d)` on the decimal tail prevents the match from biting
 * into a longer number on a subsequent line (e.g. `$1,2\n34.56789` would not
 * match because `567` follows the `.56`). Guards against false-positive
 * merges in long digit runs from OCR garbage.
 */

const PRICE_PREFIX = "(?:\\bHK\\$|\\bNT\\$|\\bMX\\$|\\bRD\\$|\\bS\\$|\\bA\\$|\\bUS\\$|\\bRM|[$€£¥₹₩฿₫₱]|د\\.إ)";

// Globally scoped so .replace() can sweep every wrap in a multi-line block.
// The capture groups feed the merge function.
const PRICE_WRAP_RE = new RegExp(
  `(${PRICE_PREFIX})\\s*(\\d{1,3}),(\\d{1,2})[ \\t]*\\n[ \\t]*(\\d{1,3})\\.(\\d{1,2})(?!\\d)`,
  "g"
);

/**
 * #198: Context-aware no-comma wrap preprocessor.
 *
 * The #215 preprocessor explicitly declines to touch no-comma wraps like
 * `$1\n234.56` because they're ambiguous with legitimate distinct-price
 * sequences (e.g. `Total $5\n10 items` where `$5` and `10` are unrelated).
 * The ambiguity is lexical — the text alone can't tell us which reading is
 * intended. But OCR from receipts is not just text: it has structure, and
 * the structure cue is a TOTAL-style keyword *immediately before* the
 * sigil. When the surrounding context is "GRAND TOTAL $1\n234.56", there
 * is no plausible reading in which `$1` and `234.56` are two distinct
 * amounts — a TOTAL line carries exactly one value by definition.
 *
 * So we add a second pass that merges the no-comma shape ONLY when gated
 * by a TOTAL-ish keyword. The regex looks for:
 *   - `TOTAL` / `SUBTOTAL` / `GRAND TOTAL` / `AMOUNT (DUE)?` / `BALANCE`
 *     / `DUE` / `TO PAY` / `PAYMENT` / `CHARGE` / `NET`
 *   - optional colon and whitespace
 *   - a currency prefix
 *   - 1–3 leading digits
 *   - a line break
 *   - exactly 3 digits (thousands grouping) and a `.\d{1,2}` tail
 *
 * The "exactly 3 digits on the wrapped line" constraint is the second
 * guard: legitimate multi-digit wraps under a TOTAL header would use a
 * `1,234` comma form (handled by #215), so a no-comma wrap must be
 * consuming the thousands separator, which means the wrapped segment
 * must be exactly 3 digits. Anything else is not a wrap under this rule.
 *
 * Shape (gritty regex notes):
 *   - `keyword`    — TOTAL/SUBTOTAL/etc., case-insensitive, word-bounded
 *   - `.{0,20}?`   — lazy fill for "TOTAL :" / "TOTAL DUE" / "TO PAY USD"
 *                    between keyword and prefix (keeps false-positive rate
 *                    low by capping at 20 chars so a whole paragraph
 *                    can't bridge a keyword to an unrelated sigil)
 *   - `prefix`     — currency sigil
 *   - `headInt`    — 1–3 digits before the line break
 *   - `\n` + ws    — line break and any whitespace at start of next line
 *   - `midDigits`  — EXACTLY 3 digits (thousands grouping)
 *   - `decimalTail` — `.` then 1–2 digits, NOT followed by another digit
 *
 * Example trace for `GRAND TOTAL $1\n234.56`:
 *   keyword=`GRAND TOTAL `, prefix=`$`, headInt=`1`, midDigits=`234`,
 *   decimalTail=`56`
 *   merged = `GRAND TOTAL $1234.56` → USD 1234.56
 *
 * Conservative by design: without the keyword gate, the naive shape would
 * false-merge on `$5\n10 items` and `$12\n345 CUSTOMERS`. The keyword is
 * the one thing that makes the merge safe — it tells us the price belongs
 * to a total line, and total lines carry one value.
 */
const TOTAL_KEYWORDS = [
  "GRAND\\s+TOTAL",
  "SUB[-\\s]?TOTAL",
  "TOTAL(?:\\s+DUE)?",
  "AMOUNT(?:\\s+DUE)?",
  "BALANCE(?:\\s+DUE)?",
  "NET(?:\\s+TOTAL)?",
  "TO\\s+PAY",
  "PAYMENT(?:\\s+DUE)?",
  "CHARGE",
  "DUE",
].join("|");

// The keyword-gated no-comma wrap regex. `i` flag for case-insensitive
// keyword match; `g` for multi-wrap sweep; keyword is bounded on both sides
// (word boundary before, up to 20 non-newline chars after) so we can't
// accidentally anchor to a keyword on a distant earlier line.
const NO_COMMA_WRAP_RE = new RegExp(
  `\\b(?:${TOTAL_KEYWORDS})\\b[^\\n]{0,20}?(${PRICE_PREFIX})\\s*(\\d{1,3})[ \\t]*\\n[ \\t]*(\\d{3})\\.(\\d{1,2})(?!\\d)`,
  "gi"
);

/**
 * #203: Context-aware no-decimal wrap preprocessor.
 *
 * The third wrap shape the OCR corpus turns up is `$1,234\n.56` — a complete
 * US-thousands integer on the first line, then a bare `.56` fractional tail
 * on the next line. Without preprocessing, `detectPricesInText` pulls the
 * first half out as `$1,234` (which `parsePrice` reads as 1234 via Rule 3
 * thousands-strip) and leaves the orphaned `.56` fragment dangling.
 *
 * This shape is strictly more ambiguous than the #215 comma-wrap and #198
 * no-comma-wrap cases: a stray `.56` on its own line is far more often an
 * OCR smudge than an intended decimal tail. So the gate is the strongest of
 * the three:
 *
 *  1. **Head must be a complete thousands-grouped integer** — `\d{1,3},\d{3}`
 *     (optionally with additional comma groups, but at least one). A bare
 *     `$5\n.56` or `$12\n.56` does NOT match because those heads have no
 *     thousands comma and could just be `$5` followed by garbage.
 *  2. **Head must be preceded by a TOTAL-style keyword** — same keyword set
 *     as the #198 pass, same 20-char lazy-fill window. A TOTAL line carries
 *     one value, which eliminates the "two unrelated prices on adjacent
 *     lines" false positive.
 *  3. **Wrapped segment must be EXACTLY `.\d{1,2}` with no leading digits** —
 *     `$1,234\n5.67` (a legitimate 5-item count following a total) does NOT
 *     match because the wrapped line has a leading digit before any decimal
 *     point. Only a bare `.56` fractional tail triggers the merge.
 *  4. **`(?!\d)` negative lookahead on the decimal tail** — blocks the merge
 *     from eating into `.56789` garbage runs, same as the other two passes.
 *
 * Under these constraints the merge is safe: there is no plausible two-
 * price reading of "TOTAL $1,234\n.56" because `.56` cannot stand alone as
 * a price (no sigil, no integer part). The only readings are (a) OCR
 * smudge, pass through — but we're gated on a TOTAL keyword which makes
 * the smudge reading implausible; and (b) wrapped tail, merge.
 *
 * Shape:
 *   - `keyword`     — TOTAL/SUBTOTAL/etc., case-insensitive, word-bounded
 *   - `.{0,20}?`    — lazy fill for "TOTAL :" / "TO PAY USD" etc.
 *   - `prefix`      — currency sigil
 *   - `headInt`     — 1–3 digits + at least one `,\d{3}` thousands group
 *   - `\n` + ws     — line break and any whitespace at start of next line
 *   - `decimalTail` — `.` then 1–2 digits, NOT followed by another digit
 *
 * Example trace for `TOTAL $1,234\n.56`:
 *   keyword=`TOTAL `, prefix=`$`, headInt=`1,234`, decimalTail=`56`
 *   merged = `TOTAL $1,234.56` → parsePrice via Rule 1 → USD 1234.56
 *
 * Note the merged string still carries the thousands comma — we don't
 * strip it, just attach the decimal tail. `parseLocaleAmount` Rule 1
 * (period present → comma is thousands) handles the resulting `1,234.56`
 * correctly, which is the whole point of doing the merge at the
 * preprocessing layer.
 */
const NO_DECIMAL_WRAP_RE = new RegExp(
  `\\b(?:${TOTAL_KEYWORDS})\\b[^\\n]{0,20}?(${PRICE_PREFIX})\\s*(\\d{1,3}(?:,\\d{3})+)[ \\t]*\\n[ \\t]*\\.(\\d{1,2})(?!\\d)`,
  "gi"
);

/**
 * Merge price-shaped line wraps in OCR text. Pure, idempotent: passing the
 * same string through twice produces the same result on the second call.
 *
 * Returns the input unchanged if no wraps are found, so callers can chain it
 * unconditionally without a measurable cost on clean receipts.
 *
 * Three passes run back-to-back:
 *  1. #215 — the unambiguous comma-wrap shape (`$1,2\n34.56` → `$1234.56`)
 *  2. #198 — the no-comma wrap shape gated by a TOTAL-style keyword
 *     (`GRAND TOTAL $1\n234.56` → `GRAND TOTAL $1234.56`)
 *  3. #203 — the no-decimal wrap shape gated by both a TOTAL-style keyword
 *     AND a thousands-grouped integer head (`TOTAL $1,234\n.56` →
 *     `TOTAL $1,234.56`)
 *
 * The three passes are additive and independent because each one requires
 * a shape the others do not produce:
 *   - #215 requires a trailing comma at end of line 1
 *   - #198 requires NO comma anywhere in the head (the whole point of the
 *     no-comma rule) AND 1-3 digits in the head
 *   - #203 requires a thousands-grouped integer head (at least one `,\d{3}`
 *     group, which #198 rejects) AND a bare `.\d{1,2}` on line 2 with no
 *     leading digits
 * So running them in order is idempotent, and swapping order would not
 * change the result on clean input. We run #215 first because it's the
 * cheapest on the hot path (short regex, no keyword lookback).
 */
export function preprocessOCRPriceWraps(text: string): string {
  if (!text || !text.includes("\n")) return text;

  // #215 — comma-wrap pass.
  const afterCommaPass = text.replace(
    PRICE_WRAP_RE,
    (_match, prefix: string, headInt: string, commaTail: string, midDigits: string, decimalTail: string) => {
      // Drop the wrap comma — once head+commaTail+mid is concatenated, the
      // resulting integer part is a plain run of digits with no separator,
      // which parseLocaleAmount handles via Rule 3 (strip-commas fallthrough,
      // a no-op here because there ARE no commas).
      return `${prefix}${headInt}${commaTail}${midDigits}.${decimalTail}`;
    }
  );

  // #198 — keyword-gated no-comma wrap pass. Skip the re-scan if the first
  // pass removed all newlines (nothing left for the no-comma pass to find).
  if (!afterCommaPass.includes("\n")) return afterCommaPass;

  const afterNoCommaPass = afterCommaPass.replace(
    NO_COMMA_WRAP_RE,
    (match, prefix: string, headInt: string, midDigits: string, decimalTail: string) => {
      // Preserve the TOTAL-style keyword prefix (everything before the sigil)
      // so the downstream `detectPricesInText` sees the same narrative label
      // that was there before — we only collapse the number, not the framing.
      const keywordSpan = match.slice(0, match.indexOf(prefix));
      return `${keywordSpan}${prefix}${headInt}${midDigits}.${decimalTail}`;
    }
  );

  // #203 — keyword-gated no-decimal wrap pass. Same short-circuit: if the
  // previous passes removed every newline, nothing left for this pass.
  if (!afterNoCommaPass.includes("\n")) return afterNoCommaPass;

  return afterNoCommaPass.replace(
    NO_DECIMAL_WRAP_RE,
    (match, prefix: string, headInt: string, decimalTail: string) => {
      // Same keyword-preservation trick as #198: carry the narrative framing
      // across the merge. Unlike #198 we retain the thousands comma in the
      // head — parseLocaleAmount Rule 1 handles `1,234.56` correctly (period
      // present → comma is thousands), so no need to strip it.
      const keywordSpan = match.slice(0, match.indexOf(prefix));
      return `${keywordSpan}${prefix}${headInt}.${decimalTail}`;
    }
  );
}
