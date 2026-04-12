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

// ---- Receipt / Invoice ----

const CURRENCY_SYMBOLS = /[$€£¥₹₩฿₫₱₸₺₽₴]/;
const MONEY_PATTERN = /(?:[$€£¥₹₩฿₫₱₸₺₽₴])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:dollars?|euros?|pounds?|yen|yuan|won|USD|EUR|GBP|JPY|CNY|KRW)/gi;
const TAX_PATTERN = /(?:tax|vat|iva|impuesto|taxe|steuer|tasse|消費税|增值税)\s*[:：]?\s*(?:[$€£¥₹₩฿]?\s*[\d,.]+)/gi;
const TOTAL_PATTERN = /(?:total|grand total|subtotal|sub-total|合計|总计|합계|итого|gesamt|totale)\s*[:：]?\s*(?:[$€£¥₹₩฿]?\s*[\d,.]+)/gi;
const TIP_PATTERN = /(?:tip|gratuity|service charge|pourboire|propina|trinkgeld|チップ|小费)\s*[:：]?\s*(?:[$€£¥₹₩฿]?\s*[\d,.]+)/gi;
const DATE_PATTERN = /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g;

function extractReceiptFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  const totals = unique(matchAll(combined, TOTAL_PATTERN));
  for (const t of totals) {
    fields.push({ label: "Total", value: t, icon: "$", color: "#4ade80", action: "copy" });
  }

  const taxes = unique(matchAll(combined, TAX_PATTERN));
  for (const t of taxes) {
    fields.push({ label: "Tax/VAT", value: t, icon: "%", color: "#f59e0b", action: "copy" });
  }

  const tips = unique(matchAll(combined, TIP_PATTERN));
  for (const t of tips) {
    fields.push({ label: "Tip/Service", value: t, icon: "+", color: "#60a5fa", action: "copy" });
  }

  // All money amounts not already captured
  const allMoney = unique(matchAll(combined, MONEY_PATTERN));
  const capturedValues = new Set([...totals, ...taxes, ...tips].map((v) => v.toLowerCase()));
  for (const m of allMoney) {
    if (!capturedValues.has(m.toLowerCase())) {
      fields.push({ label: "Amount", value: m, icon: "$", color: "#a78bfa", action: "copy" });
    }
  }

  const dates = unique(matchAll(combined, DATE_PATTERN));
  for (const d of dates) {
    fields.push({ label: "Date", value: d, icon: "D", color: "#f59e0b", action: "copy" });
  }

  return fields;
}

// ---- Business Card ----

const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.\w{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s,]+/gi;
const JOB_TITLE_KEYWORDS = /(?:CEO|CTO|CFO|COO|VP|Director|Manager|Engineer|Developer|Designer|Founder|President|Head of|Lead|Senior|Junior|Associate|Consultant|Advisor|Professor|Dr\.?|MD|PhD)/gi;

function extractBusinessCardFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  // Emails
  const emails = unique(matchAll(combined, EMAIL_PATTERN));
  for (const e of emails) {
    fields.push({ label: "Email", value: e, icon: "@", color: "#60a5fa", action: "email" });
  }

  // Phones
  const phones = unique(matchAll(combined, PHONE_PATTERN).filter((p) => p.replace(/\D/g, "").length >= 7));
  for (const p of phones) {
    fields.push({ label: "Phone", value: p, icon: "#", color: "#4ade80", action: "call" });
  }

  // URLs
  const urls = unique(matchAll(combined, URL_PATTERN));
  for (const u of urls) {
    fields.push({ label: "Website", value: u, icon: "~", color: "#22d3ee", action: "url" });
  }

  // Job titles
  const titles = unique(matchAll(combined, JOB_TITLE_KEYWORDS));
  if (titles.length > 0) {
    fields.push({ label: "Title", value: titles.join(", "), icon: "T", color: "#f472b6", action: "copy" });
  }

  // Try to identify the name (first line that's not a company/email/phone/url)
  const lines = combined.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 3)) {
    if (EMAIL_PATTERN.test(line) || PHONE_PATTERN.test(line) || URL_PATTERN.test(line)) continue;
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

function extractMedicineFields(text: string, translated: string): ExtractedField[] {
  const combined = `${text}\n${translated}`;
  const fields: ExtractedField[] = [];

  // Drug names
  const drugs = unique(matchAll(combined, DRUG_NAME_PATTERN));
  for (const d of drugs) {
    fields.push({ label: "Drug Name", value: d, icon: "Rx", color: "#60a5fa", action: "copy" });
  }

  // Dosages
  const dosages = unique(matchAll(combined, DOSAGE_PATTERN));
  for (const d of dosages) {
    fields.push({ label: "Dosage", value: d, icon: "D", color: "#4ade80", action: "copy" });
  }

  // Frequency
  const freqs = unique(matchAll(combined, FREQUENCY_PATTERN));
  for (const f of freqs) {
    fields.push({ label: "Frequency", value: f, icon: "F", color: "#a78bfa", action: "copy" });
  }

  // Warnings
  const warnings = unique(matchAll(combined, WARNING_KEYWORDS));
  if (warnings.length > 0) {
    fields.push({ label: "Warnings Found", value: warnings.join(", "), icon: "!", color: "#ef4444", action: "copy" });
  }

  // Dates (expiry etc)
  const dates = unique(matchAll(combined, DATE_PATTERN));
  for (const d of dates) {
    fields.push({ label: "Date", value: d, icon: "D", color: "#f59e0b", action: "copy" });
  }

  return fields;
}

// ---- Restaurant Menu ----

const PRICE_PATTERN = /(?:[$€£¥₹₩฿₫₱₸₺₽₴])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:[$€£¥₹₩฿₫₱₸₺₽₴])/g;
const ALLERGEN_KEYWORDS = /(?:nuts?|peanut|tree nut|gluten|wheat|dairy|milk|lactose|egg|soy|soya|shellfish|fish|sesame|mustard|celery|lupin|mollusc|sulphite|sulfite|vegan|vegetarian|halal|kosher|spicy|hot|organic|gluten.?free|nut.?free|dairy.?free|含坚果|小麦|乳|卵|大豆|えび|かに|アレルギー)/gi;
const CATEGORY_KEYWORDS = /(?:appetizer|starter|entrée|main|course|dessert|drink|beverage|soup|salad|side|special|breakfast|lunch|dinner|前菜|スープ|メイン|デザート|飲み物|开胃菜|主菜|甜点|饮料)/gi;

function extractMenuFields(text: string, translated: string): ExtractedField[] {
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

  // Allergens
  const allergens = unique(matchAll(combined, ALLERGEN_KEYWORDS));
  if (allergens.length > 0) {
    fields.push({
      label: "Allergens/Dietary",
      value: allergens.join(", "),
      icon: "!",
      color: "#ef4444",
      action: "copy",
    });
  }

  // Categories
  const categories = unique(matchAll(combined, CATEGORY_KEYWORDS));
  if (categories.length > 0) {
    fields.push({
      label: "Sections",
      value: categories.join(", "),
      icon: "C",
      color: "#f59e0b",
      action: "copy",
    });
  }

  return fields;
}

// ---- Textbook / Notes ----

function extractTextbookFields(text: string, translated: string): ExtractedField[] {
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
  const dates = unique(matchAll(`${text}\n${translated}`, DATE_PATTERN));
  if (dates.length > 0) {
    fields.push({ label: "Dates Referenced", value: dates.join(", "), icon: "D", color: "#f59e0b", action: "copy" });
  }

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

  const money = unique(matchAll(combined, MONEY_PATTERN));
  for (const m of money) {
    fields.push({ label: "Amount", value: m, icon: "$", color: "#4ade80", action: "copy" });
  }

  const dates = unique(matchAll(combined, DATE_PATTERN));
  for (const d of dates) {
    fields.push({ label: "Date", value: d, icon: "D", color: "#f59e0b", action: "copy" });
  }

  const emails = unique(matchAll(combined, EMAIL_PATTERN));
  for (const e of emails) {
    fields.push({ label: "Email", value: e, icon: "@", color: "#60a5fa", action: "email" });
  }

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
