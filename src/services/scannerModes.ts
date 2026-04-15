// Scanner mode definitions with specialized entity extraction patterns

export type ScannerModeKey = "document" | "receipt" | "businessCard" | "medicine" | "menu" | "textbook";

export interface ExtractedField {
  label: string;
  value: string;
  icon: string;
  color: string;
  action?: "call" | "email" | "url" | "copy" | "contact";
}

export interface ScannerMode {
  key: ScannerModeKey;
  label: string;
  icon: string;
  description: string;
  instruction: string;
  extractFields: (text: string, translatedText: string) => ExtractedField[];
  formatNotes: (original: string, translated: string, fields: ExtractedField[]) => string;
}

// ---- Pattern helpers ----

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

function matchAll(text: string, pattern: RegExp): string[] {
  return (text.match(pattern) || []).map((m) => m.trim());
}

/**
 * Run `pattern` against `text`, dedupe, and push one {@link ExtractedField}
 * per unique match. Collapses the "matchAll → unique → for-of → push" shape
 * that was duplicated 11× across the six mode extractors (#204). Returns the
 * deduped match array so callers can still gate follow-up logic on what was
 * captured (e.g. the receipt extractor's `capturedValues` dedup set).
 */
function addMatchFields(
  text: string,
  pattern: RegExp,
  fields: ExtractedField[],
  label: string,
  icon: string,
  color: string,
  action: ExtractedField["action"] = "copy"
): string[] {
  const matches = unique(matchAll(text, pattern));
  for (const value of matches) {
    fields.push({ label, value, icon, color, action });
  }
  return matches;
}

/**
 * Same as {@link addMatchFields} but collapses all matches into a single
 * comma-joined field when one or more are found. Used for aggregate buckets
 * like "Warnings Found" (medicine), "Allergens/Dietary" (menu), "Title"
 * (business card), and "Sections" (menu) — where the UI renders a single
 * badge rather than one chip per match.
 */
function addJoinedMatchField(
  text: string,
  pattern: RegExp,
  fields: ExtractedField[],
  label: string,
  icon: string,
  color: string,
  action: ExtractedField["action"] = "copy"
): string[] {
  const matches = unique(matchAll(text, pattern));
  if (matches.length > 0) {
    fields.push({ label, value: matches.join(", "), icon, color, action });
  }
  return matches;
}

// ---- Receipt / Invoice ----

const CURRENCY_SYMBOLS = /[$€£¥₹₩฿₫₱₸₺₽₴]/;
const MONEY_PATTERN = /(?:[$€£¥₹₩฿₫₱₸₺₽₴])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:dollars?|euros?|pounds?|yen|yuan|won|USD|EUR|GBP|JPY|CNY|KRW)/gi;
const TAX_PATTERN = /(?:tax|vat|iva|impuesto|taxe|steuer|tasse|消費税|增值税)\s*[:：]?\s*(?:[$€£¥₹₩฿]?\s*[\d,.]+)/gi;
const TOTAL_PATTERN = /(?:total|grand total|subtotal|sub-total|合計|总计|합계|итого|gesamt|totale)\s*[:：]?\s*(?:[$€£¥₹₩฿]?\s*[\d,.]+)/gi;
const TIP_PATTERN = /(?:tip|gratuity|service charge|pourboire|propina|trinkgeld|チップ|小费)\s*[:：]?\s*(?:[$€£¥₹₩฿]?\s*[\d,.]+)/gi;
const DATE_PATTERN = /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g;

// Exported for unit tests (run 16). The extractor is pure — same inputs
// always produce the same output — so we test it directly instead of
// going through the ScannerMode.extractFields indirection.
export function extractReceiptFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  const totals = addMatchFields(combined, TOTAL_PATTERN, fields, "Total", "$", "#4ade80");
  const taxes = addMatchFields(combined, TAX_PATTERN, fields, "Tax/VAT", "%", "#f59e0b");
  const tips = addMatchFields(combined, TIP_PATTERN, fields, "Tip/Service", "+", "#60a5fa");

  // All money amounts not already captured — can't use addMatchFields here
  // because we need to filter against the capturedValues dedup set.
  const allMoney = unique(matchAll(combined, MONEY_PATTERN));
  const capturedValues = new Set([...totals, ...taxes, ...tips].map((v) => v.toLowerCase()));
  for (const m of allMoney) {
    if (!capturedValues.has(m.toLowerCase())) {
      fields.push({ label: "Amount", value: m, icon: "$", color: "#a78bfa", action: "copy" });
    }
  }

  addMatchFields(combined, DATE_PATTERN, fields, "Date", "D", "#f59e0b");

  return fields;
}

// ---- Business Card ----

const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.\w{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s,]+/gi;
const JOB_TITLE_KEYWORDS = /(?:CEO|CTO|CFO|COO|VP|Director|Manager|Engineer|Developer|Designer|Founder|President|Head of|Lead|Senior|Junior|Associate|Consultant|Advisor|Professor|Dr\.?|MD|PhD)/gi;

// Non-global copies for stateless `.test()` in the name-picker loop. Using
// the `/g` regexes above directly with `.test()` would mutate their
// `lastIndex` between iterations, causing a phone-shaped second line to
// slip past the guard when the first line already matched PHONE_PATTERN
// (`lastIndex` carries over to a shorter string, `.test()` returns false,
// and a phone number gets accepted as the Name). Regression fence is in
// scannerModes.test.ts.
const EMAIL_TEST_RE = /[\w.+-]+@[\w.-]+\.\w{2,}/i;
const PHONE_TEST_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
const URL_TEST_RE = /(?:https?:\/\/|www\.)[^\s,]+/i;

// Exported for unit tests (run 16). Same rationale as extractReceiptFields.
export function extractBusinessCardFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  addMatchFields(combined, EMAIL_PATTERN, fields, "Email", "@", "#60a5fa", "email");

  // Phones — can't use addMatchFields because we filter on digit-count first.
  const phones = unique(matchAll(combined, PHONE_PATTERN).filter((p) => p.replace(/\D/g, "").length >= 7));
  for (const p of phones) {
    fields.push({ label: "Phone", value: p, icon: "#", color: "#4ade80", action: "call" });
  }

  addMatchFields(combined, URL_PATTERN, fields, "Website", "~", "#22d3ee", "url");
  addJoinedMatchField(combined, JOB_TITLE_KEYWORDS, fields, "Title", "T", "#f472b6");

  // Try to identify the name (first line that's not a company/email/phone/url)
  const lines = combined.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 3)) {
    if (EMAIL_TEST_RE.test(line) || PHONE_TEST_RE.test(line) || URL_TEST_RE.test(line)) continue;
    if (line.length > 40) continue; // Probably not a name
    if (/^\d/.test(line)) continue; // Starts with number
    fields.unshift({ label: "Name", value: line, icon: "P", color: "#c084fc", action: "contact" });
    break;
  }

  return fields;
}

// ---- Medicine / Prescription ----

const DOSAGE_PATTERN = /\d+\s*(?:mg|ml|mcg|g|iu|µg|tablet|capsule|cap|tab|pill|dose|drop|spray|patch|unit)/gi;
const FREQUENCY_PATTERN = /(?:once|twice|three times|four times|\d+\s*(?:times?|x))\s*(?:a|per)\s*(?:day|daily|week|weekly|month|hour|night|morning|evening)|(?:every\s*\d+\s*hours?)|(?:b\.?i\.?d\.?|t\.?i\.?d\.?|q\.?i\.?d\.?|q\.?d\.?|q\.?h\.?|p\.?r\.?n\.?|stat|hs|ac|pc)/gi;
const WARNING_KEYWORDS = /(?:warning|caution|do not|avoid|allergy|allergic|side effect|contraindic|interaction|overdose|poison|emergency|danger|precaution|注意|警告|禁忌|副作用)/gi;
const DRUG_NAME_PATTERN = /(?:acetaminophen|ibuprofen|aspirin|amoxicillin|metformin|lisinopril|atorvastatin|omeprazole|amlodipine|metoprolol|losartan|gabapentin|hydrochlorothiazide|sertraline|paracetamol|diclofenac|ciprofloxacin|azithromycin|prednisone|insulin|codeine|morphine|tramadol|oxycodone|penicillin|cephalexin)/gi;

// Exported for unit tests (run 17). Same pure-extractor rationale as
// extractReceiptFields / extractBusinessCardFields — medicine/menu/textbook
// scanner output must not silently drift when a keyword list changes or a
// regex bound shifts, and component-level snapshot tests are a poor fit
// because the extractors don't render anything.
export function extractMedicineFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  addMatchFields(combined, DRUG_NAME_PATTERN, fields, "Drug Name", "Rx", "#60a5fa");
  addMatchFields(combined, DOSAGE_PATTERN, fields, "Dosage", "D", "#4ade80");
  addMatchFields(combined, FREQUENCY_PATTERN, fields, "Frequency", "F", "#a78bfa");
  addJoinedMatchField(combined, WARNING_KEYWORDS, fields, "Warnings Found", "!", "#ef4444");
  addMatchFields(combined, DATE_PATTERN, fields, "Date", "D", "#f59e0b");

  return fields;
}

// ---- Restaurant Menu ----

const PRICE_PATTERN = /(?:[$€£¥₹₩฿₫₱₸₺₽₴])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:[$€£¥₹₩฿₫₱₸₺₽₴])/g;
const ALLERGEN_KEYWORDS = /(?:nuts?|peanut|tree nut|gluten|wheat|dairy|milk|lactose|egg|soy|soya|shellfish|fish|sesame|mustard|celery|lupin|mollusc|sulphite|sulfite|vegan|vegetarian|halal|kosher|spicy|hot|organic|gluten.?free|nut.?free|dairy.?free|含坚果|小麦|乳|卵|大豆|えび|かに|アレルギー)/gi;
const CATEGORY_KEYWORDS = /(?:appetizer|starter|entrée|main|course|dessert|drink|beverage|soup|salad|side|special|breakfast|lunch|dinner|前菜|スープ|メイン|デザート|飲み物|开胃菜|主菜|甜点|饮料)/gi;

// Exported for unit tests (run 17). See extractMedicineFields rationale.
export function extractMenuFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  // Prices
  const prices = unique(matchAll(combined, PRICE_PATTERN));
  const priceNums = prices.map((p) => {
    const num = parseFloat(p.replace(/[^\d.]/g, ""));
    return { text: p, num };
  }).filter((p) => !isNaN(p.num));

  if (priceNums.length > 0) {
    const min = priceNums.reduce((a, b) => a.num < b.num ? a : b);
    const max = priceNums.reduce((a, b) => a.num > b.num ? a : b);
    fields.push({
      label: "Price Range",
      value: min.text === max.text ? min.text : `${min.text} – ${max.text}`,
      icon: "$",
      color: "#4ade80",
      action: "copy",
    });
    fields.push({
      label: "Items with Prices",
      value: `${priceNums.length} items found`,
      icon: "#",
      color: "#a78bfa",
      action: "copy",
    });
  }

  addJoinedMatchField(combined, ALLERGEN_KEYWORDS, fields, "Allergens/Dietary", "!", "#ef4444");
  addJoinedMatchField(combined, CATEGORY_KEYWORDS, fields, "Sections", "C", "#f59e0b");

  return fields;
}

// ---- Textbook / Notes ----

// Exported for unit tests (run 17). See extractMedicineFields rationale.
export function extractTextbookFields(text: string, translated: string): ExtractedField[] {
  const fields: ExtractedField[] = [];

  // Word/sentence counts
  const words = translated.trim().split(/\s+/).filter(Boolean).length;
  const sentences = translated.split(/[.!?。！？]+/).filter((s) => s.trim()).length;
  const paragraphs = translated.split(/\n\s*\n/).filter((p) => p.trim()).length;

  fields.push({ label: "Words", value: String(words), icon: "W", color: "#60a5fa", action: "copy" });
  fields.push({ label: "Sentences", value: String(sentences), icon: "S", color: "#a78bfa", action: "copy" });
  if (paragraphs > 1) {
    fields.push({ label: "Paragraphs", value: String(paragraphs), icon: "P", color: "#4ade80", action: "copy" });
  }

  // Dates mentioned
  addJoinedMatchField(`${text}\n${translated}`, DATE_PATTERN, fields, "Dates Referenced", "D", "#f59e0b");

  // Numbers / figures
  const figures = unique(matchAll(translated, /\b\d[\d,.]+%?\b/g)).filter((n) => n.length > 1).slice(0, 10);
  if (figures.length > 0) {
    fields.push({ label: "Key Numbers", value: figures.join(", "), icon: "#", color: "#22d3ee", action: "copy" });
  }

  return fields;
}

// ---- General Document (existing) ----

function extractDocumentFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  addMatchFields(combined, MONEY_PATTERN, fields, "Amount", "$", "#4ade80");
  addMatchFields(combined, DATE_PATTERN, fields, "Date", "D", "#f59e0b");
  addMatchFields(combined, EMAIL_PATTERN, fields, "Email", "@", "#60a5fa", "email");

  // Phone has the >=7-digit floor; can't go through addMatchFields.
  const phones = unique(matchAll(combined, PHONE_PATTERN).filter((p) => p.replace(/\D/g, "").length >= 7));
  for (const p of phones) {
    fields.push({ label: "Phone", value: p, icon: "#", color: "#4ade80", action: "call" });
  }

  return fields;
}

// ---- Format notes for saving ----

function defaultFormatNotes(original: string, translated: string, fields: ExtractedField[]): string {
  let note = "";
  if (fields.length > 0) {
    note += "KEY INFORMATION:\n";
    for (const f of fields) {
      note += `  ${f.label}: ${f.value}\n`;
    }
    note += "\n";
  }
  note += "TRANSLATION:\n" + translated + "\n\n";
  note += "ORIGINAL:\n" + original;
  return note;
}

function receiptFormatNotes(original: string, translated: string, fields: ExtractedField[]): string {
  let note = "RECEIPT SUMMARY:\n";
  const totals = fields.filter((f) => f.label === "Total");
  const taxes = fields.filter((f) => f.label === "Tax/VAT");
  const amounts = fields.filter((f) => f.label === "Amount");
  if (totals.length) note += `  Total: ${totals.map((t) => t.value).join(", ")}\n`;
  if (taxes.length) note += `  Tax: ${taxes.map((t) => t.value).join(", ")}\n`;
  if (amounts.length) note += `  Line items: ${amounts.length}\n`;
  note += "\nTRANSLATED RECEIPT:\n" + translated;
  return note;
}

function businessCardFormatNotes(original: string, translated: string, fields: ExtractedField[]): string {
  let note = "CONTACT:\n";
  for (const f of fields) {
    note += `  ${f.label}: ${f.value}\n`;
  }
  note += "\nOriginal text:\n" + original;
  if (translated !== original) note += "\nTranslated:\n" + translated;
  return note;
}

function textbookFormatNotes(original: string, translated: string, _fields: ExtractedField[]): string {
  return translated + "\n\n---\nOriginal:\n" + original;
}

// ---- Mode definitions ----

export const SCANNER_MODES: ScannerMode[] = [
  {
    key: "document",
    label: "Document",
    icon: "📄",
    description: "General document analysis",
    instruction: "Position document within frame",
    extractFields: extractDocumentFields,
    formatNotes: defaultFormatNotes,
  },
  {
    key: "receipt",
    label: "Receipt",
    icon: "🧾",
    description: "Extract totals, tax, line items",
    instruction: "Capture the full receipt",
    extractFields: extractReceiptFields,
    formatNotes: receiptFormatNotes,
  },
  {
    key: "businessCard",
    label: "Card",
    icon: "💼",
    description: "Extract contact info",
    instruction: "Center the business card",
    extractFields: extractBusinessCardFields,
    formatNotes: businessCardFormatNotes,
  },
  {
    key: "medicine",
    label: "Medicine",
    icon: "💊",
    description: "Drug names, dosages, warnings",
    instruction: "Capture the medication label",
    extractFields: extractMedicineFields,
    formatNotes: defaultFormatNotes,
  },
  {
    key: "menu",
    label: "Menu",
    icon: "🍽️",
    description: "Prices, allergens, categories",
    instruction: "Capture the menu page",
    extractFields: extractMenuFields,
    formatNotes: defaultFormatNotes,
  },
  {
    key: "textbook",
    label: "Notes",
    icon: "📚",
    description: "Scan & save as translated notes",
    instruction: "Capture the textbook page",
    extractFields: extractTextbookFields,
    formatNotes: textbookFormatNotes,
  },
];

export function getScannerMode(key: ScannerModeKey): ScannerMode {
  return SCANNER_MODES.find((m) => m.key === key) || SCANNER_MODES[0];
}
