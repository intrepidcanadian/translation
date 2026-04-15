/**
 * @jest-environment node
 *
 * Unit tests for the scanner-mode entity extractors (run 16). The extractors
 * had zero direct test coverage — the only exercise they got was through
 * the live camera scanner UI, which meant regex drift in any of the six
 * mode-specific extractors would silently ship. This suite pins the receipt
 * and business-card extractors (the two most heavily used modes) with
 * representative fixtures.
 *
 * What we're specifically pinning:
 *
 *   Receipt — that the three high-value fields (Total, Tax, Tip) get pulled
 *   into their own typed buckets instead of collapsing into a generic
 *   "Amount" bag. Also that dates extract cleanly, multi-currency text
 *   isn't rejected, and duplicate-value deduplication runs (the
 *   `capturedValues` Set in extractReceiptFields).
 *
 *   Business card — that emails / phones / URLs / job titles each surface
 *   as their own field with the right `action` verb (so the UI can hook up
 *   tel:, mailto:, https: taps), and that the "first plausible line as the
 *   Name" heuristic picks the right line when preceded by company text.
 *   Pins the 40-char length guard and the leading-digit guard that
 *   distinguish a name from an address line.
 *
 * We do NOT test the menu/medicine/textbook/document extractors here —
 * they have narrower keyword vocabularies that are essentially regression
 * guards against their own source code. Receipts and business cards carry
 * the bulk of the product traffic and are worth the explicit fence.
 */

import {
  extractReceiptFields,
  extractBusinessCardFields,
} from "../services/scannerModes";

describe("extractReceiptFields (run 16)", () => {
  it("pulls Total, Tax, and Tip into distinct typed fields", () => {
    const text = "Subtotal: $42.00\nTax: $3.36\nTip: $8.00\nTotal: $53.36";
    const fields = extractReceiptFields(text, "");
    const byLabel = new Map(fields.map((f) => [f.label, f]));
    // Total → the label is "Total", not "Subtotal", so the Set picks the
    // first match. TOTAL_PATTERN matches "Subtotal" and "Total" both as
    // the total bucket — this test pins the current (intentional) behavior.
    expect(byLabel.has("Total")).toBe(true);
    expect(byLabel.has("Tax/VAT")).toBe(true);
    expect(byLabel.has("Tip/Service")).toBe(true);
  });

  it("assigns the correct color and icon to each category", () => {
    // The UI relies on the `color`/`icon` fields to render consistently.
    // Threading these through a rename would break receipt rendering, so
    // pin them explicitly — if the constants in the extractor drift, this
    // test catches it immediately.
    const fields = extractReceiptFields("Total: $10.00\nTax: $0.80\nTip: $2.00", "");
    const total = fields.find((f) => f.label === "Total");
    const tax = fields.find((f) => f.label === "Tax/VAT");
    const tip = fields.find((f) => f.label === "Tip/Service");
    expect(total?.color).toBe("#4ade80"); // green
    expect(tax?.color).toBe("#f59e0b"); // amber
    expect(tip?.color).toBe("#60a5fa"); // blue
    expect(total?.action).toBe("copy");
  });

  it("extracts generic Amount fields for money that isn't total/tax/tip", () => {
    // A receipt line-item price should surface as an Amount, not disappear.
    // capturedValues dedup must NOT swallow the line-item amount.
    const fields = extractReceiptFields("Burger $12.50\nFries $4.00\nTotal: $16.50", "");
    const amounts = fields.filter((f) => f.label === "Amount");
    // Both line items should be present.
    const values = amounts.map((a) => a.value);
    expect(values.some((v) => v.includes("12.50"))).toBe(true);
    expect(values.some((v) => v.includes("4.00"))).toBe(true);
  });

  it("does NOT duplicate a value across Total and Amount buckets", () => {
    // Regression fence on the `capturedValues` Set: if a value is captured
    // as Total, it must not also appear as a generic Amount. Otherwise the
    // receipt UI would render the same number twice.
    const fields = extractReceiptFields("Total: $99.99", "");
    const totalValues = fields.filter((f) => f.label === "Total").map((f) => f.value.toLowerCase());
    const amountValues = fields.filter((f) => f.label === "Amount").map((f) => f.value.toLowerCase());
    for (const av of amountValues) {
      expect(totalValues).not.toContain(av);
    }
  });

  it("extracts dates from the receipt", () => {
    const fields = extractReceiptFields("Receipt 2026-04-15\nTotal: $10", "");
    const dates = fields.filter((f) => f.label === "Date");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates[0].value).toBe("2026-04-15");
  });

  it("searches both the original and translated text (combined corpus)", () => {
    // The extractor concatenates `${text}\n${translated}`, so a value that
    // appears only in the translated string must still surface. This is how
    // we handle receipts where OCR saw the original-language "Total" but
    // the user reads the translated label.
    const fields = extractReceiptFields("", "Total: $25.00");
    expect(fields.some((f) => f.label === "Total")).toBe(true);
  });

  it("returns an empty array on non-receipt text with no monetary content", () => {
    expect(extractReceiptFields("Hello world this is not a receipt", "")).toEqual([]);
  });

  it("handles multi-currency symbols in a single receipt", () => {
    // Travelers scan mixed-currency receipts (e.g. duty-free). The money
    // pattern must accept all supported sigils, not just $.
    const fields = extractReceiptFields("Total: €45.00\nTax: £3.60", "");
    const labels = fields.map((f) => f.label);
    expect(labels).toContain("Total");
    expect(labels).toContain("Tax/VAT");
  });
});

describe("extractBusinessCardFields (run 16)", () => {
  it("extracts an email with the 'email' action verb", () => {
    const fields = extractBusinessCardFields("contact@example.com", "");
    const email = fields.find((f) => f.label === "Email");
    expect(email).toBeDefined();
    expect(email?.value).toBe("contact@example.com");
    expect(email?.action).toBe("email");
  });

  it("extracts a phone with the 'call' action verb", () => {
    const fields = extractBusinessCardFields("+1 555-123-4567", "");
    const phone = fields.find((f) => f.label === "Phone");
    expect(phone).toBeDefined();
    expect(phone?.action).toBe("call");
  });

  it("rejects phone-shaped strings with fewer than 7 digits", () => {
    // The filter `p.replace(/\D/g, "").length >= 7` is the floor for "real
    // phone number vs. date or ID". Pin it so a relaxed regex doesn't
    // flood the output with false positives.
    const fields = extractBusinessCardFields("Room 123-45", "");
    expect(fields.some((f) => f.label === "Phone")).toBe(false);
  });

  it("extracts a URL with the 'url' action verb", () => {
    const fields = extractBusinessCardFields("https://example.com", "");
    const url = fields.find((f) => f.label === "Website");
    expect(url).toBeDefined();
    expect(url?.action).toBe("url");
  });

  it("extracts a job title and joins multiple titles with a comma", () => {
    const fields = extractBusinessCardFields("Senior Engineer\nCTO", "");
    const title = fields.find((f) => f.label === "Title");
    expect(title).toBeDefined();
    // Both titles should appear in a single comma-joined field.
    expect(title?.value).toMatch(/Senior/);
    expect(title?.value).toMatch(/CTO/);
  });

  it("picks the first plausible line as the Name and prepends it via unshift", () => {
    // The name heuristic skips lines containing email/phone/url, lines
    // longer than 40 chars, and lines starting with a digit. On a normal
    // card the first line is the name, so we should see it on top.
    const fields = extractBusinessCardFields(
      "Jane Smith\nCTO\njane@example.com\n+1 555-987-6543",
      ""
    );
    const name = fields.find((f) => f.label === "Name");
    expect(name).toBeDefined();
    expect(name?.value).toBe("Jane Smith");
    expect(name?.action).toBe("contact");
    // unshift means the Name field is at index 0 in the output array.
    expect(fields[0].label).toBe("Name");
  });

  it("skips a too-long line (>40 chars) when looking for the Name", () => {
    // A 41-char first line is almost certainly a tagline or address, not
    // a person's name. The heuristic must pass it over.
    const longLine = "x".repeat(41);
    const fields = extractBusinessCardFields(`${longLine}\nJane Smith`, "");
    const name = fields.find((f) => f.label === "Name");
    expect(name?.value).toBe("Jane Smith");
  });

  it("skips a line starting with a digit when looking for the Name", () => {
    // Street addresses usually begin with a number — those are not names.
    const fields = extractBusinessCardFields("123 Main Street\nJane Smith", "");
    const name = fields.find((f) => f.label === "Name");
    expect(name?.value).toBe("Jane Smith");
  });

  it("returns no Name field when no plausible candidate line exists in the first 3", () => {
    // Pure contact-info card — no name line, just email + phone. The
    // extractor should still emit the typed fields without inventing a
    // Name from the email address. (The heuristic loops the first 3
    // lines, so a card that leads with email/phone/url gets no Name.)
    const fields = extractBusinessCardFields(
      "jane@example.com\n+1 555-987-6543\nhttps://example.com",
      ""
    );
    expect(fields.some((f) => f.label === "Name")).toBe(false);
    // But the other fields must still land.
    expect(fields.some((f) => f.label === "Email")).toBe(true);
    expect(fields.some((f) => f.label === "Phone")).toBe(true);
    expect(fields.some((f) => f.label === "Website")).toBe(true);
  });

  it("deduplicates repeated values across the combined corpus", () => {
    // If the same email appears in both original and translated text,
    // `unique()` must collapse them. Pins the dedup contract.
    const fields = extractBusinessCardFields("jane@example.com", "jane@example.com");
    const emails = fields.filter((f) => f.label === "Email");
    expect(emails.length).toBe(1);
  });
});
