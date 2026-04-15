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
 * Merge price-shaped line wraps in OCR text. Pure, idempotent: passing the
 * same string through twice produces the same result on the second call.
 *
 * Returns the input unchanged if no wraps are found, so callers can chain it
 * unconditionally without a measurable cost on clean receipts.
 */
export function preprocessOCRPriceWraps(text: string): string {
  if (!text || !text.includes("\n")) return text;
  return text.replace(
    PRICE_WRAP_RE,
    (_match, prefix: string, headInt: string, commaTail: string, midDigits: string, decimalTail: string) => {
      // Drop the wrap comma — once head+commaTail+mid is concatenated, the
      // resulting integer part is a plain run of digits with no separator,
      // which parseLocaleAmount handles via Rule 3 (strip-commas fallthrough,
      // a no-op here because there ARE no commas).
      return `${prefix}${headInt}${commaTail}${midDigits}.${decimalTail}`;
    }
  );
}
