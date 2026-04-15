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
 * Run 17 adds coverage for the menu / medicine / textbook extractors,
 * because those keyword lists drift just as easily as the receipt regexes
 * — a user renaming ALLERGEN_KEYWORDS or DRUG_NAME_PATTERN would silently
 * break the scanner UI with no unit-level fence. Each suite pins the
 * high-value contract (what gets extracted, what icons/colors it gets,
 * how the action verbs wire up) without locking in every keyword.
 */

import {
  extractReceiptFields,
  extractBusinessCardFields,
  extractMedicineFields,
  extractMenuFields,
  extractTextbookFields,
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

  it("does NOT accept a phone-number line as the Name when a prior line matched PHONE_PATTERN (stateful regex bug regression fence)", () => {
    // Real bug, run 18: the name-picker loop used to call
    // `PHONE_PATTERN.test(line)` directly on the global regex. After the
    // first line matched (advancing `lastIndex` past the second line's
    // length), the second test would short-circuit to false, the line
    // would skip the EMAIL/PHONE/URL guard, and a phone number would be
    // unshifted as the Name. Fix: use non-global EMAIL_TEST_RE /
    // PHONE_TEST_RE / URL_TEST_RE for the stateless `.test()` call.
    //
    // The fixture must reproduce the exact failure shape: line 1 has a
    // phone match LONGER than line 2 so the carried-over `lastIndex`
    // exceeds line 2's length. Line 1 is correctly skipped (matches
    // PHONE_TEST_RE). Line 2 must also be skipped because it's still a
    // phone number — and previously wasn't, due to the bug.
    const fields = extractBusinessCardFields(
      "+1-555-123-4567-ext-999\n555-987-6543\nJane Doe",
      ""
    );
    const name = fields.find((f) => f.label === "Name");
    // Critical assertion: the Name (if any) must be "Jane Doe", NOT a
    // phone number masquerading as a name.
    expect(name?.value).toBe("Jane Doe");
    // And both phone numbers must still surface in the Phone fields.
    const phones = fields.filter((f) => f.label === "Phone");
    expect(phones.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Run 17: medicine / menu / textbook extractors.
// Narrow keyword vocabularies are still worth pinning because a traveler
// scanning a prescription label in a foreign country has high safety stakes
// — a silently-dropped warning or dosage is a user-harm failure mode, not
// just a rendering glitch. Receipts carry financial stakes, these carry
// health/safety stakes, menus carry allergen stakes. All three justify the
// fence.
// ─────────────────────────────────────────────────────────────────────────

describe("extractMedicineFields (run 17)", () => {
  it("extracts a known drug name with the Rx icon", () => {
    // DRUG_NAME_PATTERN is a literal alternation of common generic names;
    // the set is the product contract. Pin the extraction for a small
    // representative sample so a typo in the list fails loudly.
    const fields = extractMedicineFields("Take ibuprofen 400mg twice daily", "");
    const drug = fields.find((f) => f.label === "Drug Name");
    expect(drug).toBeDefined();
    expect(drug?.value.toLowerCase()).toBe("ibuprofen");
    expect(drug?.icon).toBe("Rx");
  });

  it("extracts a dosage with amount + unit", () => {
    const fields = extractMedicineFields("500mg once daily", "");
    const dosage = fields.find((f) => f.label === "Dosage");
    expect(dosage).toBeDefined();
    expect(dosage?.value).toMatch(/500\s*mg/i);
  });

  it("recognizes multiple dosage units (mg, ml, mcg, tablet)", () => {
    // DOSAGE_PATTERN covers several unit suffixes. Pin a sample so a
    // narrowing of the pattern fails the suite.
    const fields = extractMedicineFields("2 tablets, 10ml liquid, 250mcg injection", "");
    const dosages = fields.filter((f) => f.label === "Dosage").map((f) => f.value);
    expect(dosages.some((d) => /tablet/i.test(d))).toBe(true);
    expect(dosages.some((d) => /ml/i.test(d))).toBe(true);
    expect(dosages.some((d) => /mcg/i.test(d))).toBe(true);
  });

  it("extracts a frequency phrase ('twice a day')", () => {
    const fields = extractMedicineFields("Take one tablet twice a day", "");
    const freq = fields.find((f) => f.label === "Frequency");
    expect(freq).toBeDefined();
    expect(freq?.value.toLowerCase()).toMatch(/twice\s+a\s+day/);
  });

  it("extracts a Latin-abbreviation frequency (b.i.d.)", () => {
    // Prescription Latin — common enough on real labels to be worth pinning.
    const fields = extractMedicineFields("ibuprofen 400mg b.i.d.", "");
    const freq = fields.find((f) => f.label === "Frequency");
    expect(freq).toBeDefined();
    expect(freq?.value.toLowerCase()).toMatch(/b\.?i\.?d\.?/);
  });

  it("surfaces a warning with a red color and a single joined field", () => {
    // Warnings all collapse into one red-colored field so the UI can render
    // a single "!" badge instead of scattering them through the list.
    const fields = extractMedicineFields("Warning: do not take with alcohol. Caution when driving.", "");
    const warn = fields.find((f) => f.label === "Warnings Found");
    expect(warn).toBeDefined();
    expect(warn?.color).toBe("#ef4444"); // red
    // Multiple warning tokens joined in one field.
    expect(warn?.value.toLowerCase()).toMatch(/warning/);
    expect(warn?.value.toLowerCase()).toMatch(/caution|do not/);
  });

  it("extracts expiry dates as a Date field", () => {
    const fields = extractMedicineFields("Expires 2027-06-30\nLot 12345", "");
    const date = fields.find((f) => f.label === "Date");
    expect(date).toBeDefined();
    expect(date?.value).toBe("2027-06-30");
  });

  it("returns an empty array on unrelated text", () => {
    // No drug names, no dosages, no warnings, no dates → no fields.
    expect(extractMedicineFields("Hello world", "")).toEqual([]);
  });
});

describe("extractMenuFields (run 17)", () => {
  it("produces a price range field when multiple prices are present", () => {
    // Price Range collapses min/max into one field. The label uses an em-dash
    // separator. Pin both ends of the range so a parseFloat bug surfaces.
    const fields = extractMenuFields("Pasta $12.00\nSteak $32.50\nSalad $8.00", "");
    const range = fields.find((f) => f.label === "Price Range");
    expect(range).toBeDefined();
    expect(range?.value).toMatch(/\$8\.00.*\$32\.50/);
  });

  it("collapses a single-price menu into a single-value range", () => {
    // When min === max the extractor should emit just the one price, not
    // "$12.00 – $12.00". Pins the equality branch in the range formatter.
    const fields = extractMenuFields("Dish of the day $12.00", "");
    const range = fields.find((f) => f.label === "Price Range");
    expect(range).toBeDefined();
    expect(range?.value).toBe("$12.00");
  });

  it("counts items with prices", () => {
    const fields = extractMenuFields("Item1 $5\nItem2 $10\nItem3 $15", "");
    const count = fields.find((f) => f.label === "Items with Prices");
    expect(count).toBeDefined();
    expect(count?.value).toMatch(/3 items/);
  });

  it("surfaces an allergen field in red when dietary keywords are present", () => {
    const fields = extractMenuFields("Contains nuts and dairy. Gluten-free options.", "");
    const allergens = fields.find((f) => f.label === "Allergens/Dietary");
    expect(allergens).toBeDefined();
    expect(allergens?.color).toBe("#ef4444");
    // Multiple allergen tokens present, joined into one field.
    expect(allergens?.value.toLowerCase()).toMatch(/nut/);
    expect(allergens?.value.toLowerCase()).toMatch(/dairy|milk/);
  });

  it("surfaces menu section categories (appetizer / main / dessert)", () => {
    const fields = extractMenuFields("Appetizer\nMain Course\nDessert", "");
    const sections = fields.find((f) => f.label === "Sections");
    expect(sections).toBeDefined();
    const v = sections?.value.toLowerCase() ?? "";
    expect(v).toMatch(/appetizer/);
    expect(v).toMatch(/main|course/);
    expect(v).toMatch(/dessert/);
  });

  it("returns an empty array on a menu with no prices or keywords", () => {
    expect(extractMenuFields("Welcome to our restaurant", "")).toEqual([]);
  });

  it("does not emit a Price Range field when no prices match", () => {
    // Category-only text (no money) should skip the price branch entirely.
    const fields = extractMenuFields("Appetizer Main Dessert", "");
    expect(fields.some((f) => f.label === "Price Range")).toBe(false);
    // But should still get the Sections field.
    expect(fields.some((f) => f.label === "Sections")).toBe(true);
  });
});

describe("extractTextbookFields (run 17)", () => {
  it("counts words and sentences on the translated text", () => {
    const fields = extractTextbookFields(
      "",
      "This is a sentence. This is another one. And a third."
    );
    const words = fields.find((f) => f.label === "Words");
    const sentences = fields.find((f) => f.label === "Sentences");
    expect(words?.value).toBe("11"); // 11 words
    expect(sentences?.value).toBe("3"); // 3 sentences
  });

  it("counts paragraphs only when there is more than one", () => {
    // The extractor suppresses the Paragraphs field when paragraphs <= 1
    // so short single-paragraph notes don't get a useless "Paragraphs: 1".
    const singleParaFields = extractTextbookFields("", "Just one paragraph here.");
    expect(singleParaFields.some((f) => f.label === "Paragraphs")).toBe(false);

    const multiParaFields = extractTextbookFields(
      "",
      "First paragraph.\n\nSecond paragraph.\n\nThird paragraph."
    );
    const paras = multiParaFields.find((f) => f.label === "Paragraphs");
    expect(paras?.value).toBe("3");
  });

  it("extracts referenced dates from the combined corpus", () => {
    // `${text}\n${translated}` — dates from either side count.
    const fields = extractTextbookFields(
      "Chapter 1 — 2024-01-15",
      "See also 2023-07-20"
    );
    const dates = fields.find((f) => f.label === "Dates Referenced");
    expect(dates).toBeDefined();
    expect(dates?.value).toMatch(/2024-01-15/);
    expect(dates?.value).toMatch(/2023-07-20/);
  });

  it("extracts key numbers from the translated text, capped at 10", () => {
    // The number extractor slices to the first 10 so a table of 50 figures
    // doesn't blow out the field. Pin the cap.
    const numbers = Array.from({ length: 15 }, (_, i) => `${(i + 1) * 100}`);
    const fields = extractTextbookFields("", numbers.join(" "));
    const keyNums = fields.find((f) => f.label === "Key Numbers");
    expect(keyNums).toBeDefined();
    const extracted = keyNums?.value.split(",").map((s) => s.trim()) ?? [];
    expect(extracted.length).toBeLessThanOrEqual(10);
  });

  it("skips single-digit numbers (length > 1 guard)", () => {
    // The `.filter((n) => n.length > 1)` drops bare digits so "I have 5"
    // doesn't fill Key Numbers with useless single-char entries.
    const fields = extractTextbookFields("", "I have 5 books and 2 pens");
    const keyNums = fields.find((f) => f.label === "Key Numbers");
    // Might be undefined if no multi-char numbers are found, or present
    // but without 5 / 2.
    if (keyNums) {
      const vals = keyNums.value.split(",").map((s) => s.trim());
      expect(vals).not.toContain("5");
      expect(vals).not.toContain("2");
    }
  });

  it("always returns at least the Words and Sentences fields", () => {
    // Even an empty translated string should produce Words=0 and Sentences=0
    // — the extractor always emits those two as the baseline.
    const fields = extractTextbookFields("", "");
    expect(fields.some((f) => f.label === "Words")).toBe(true);
    expect(fields.some((f) => f.label === "Sentences")).toBe(true);
  });
});
