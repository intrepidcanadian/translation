import type { GlossaryEntry } from "./glossaryValidation";

export interface GlossaryParseResult {
  entries: GlossaryEntry[];
  imported: number;
}

const CSV_ROW_RE =
  /^"?([^"]*)"?\s*,\s*"?([^"]*)"?\s*,\s*"?([^"]*)"?\s*,\s*"?([^"]*)"?$/;

export function parseGlossaryCSV(
  csvText: string,
  existingEntries: readonly GlossaryEntry[]
): GlossaryParseResult {
  const lines = csvText.split("\n").filter((l) => l.trim());
  const start = lines[0]?.toLowerCase().startsWith("source") ? 1 : 0;
  let imported = 0;
  const entries: GlossaryEntry[] = [...existingEntries];

  for (let i = start; i < lines.length; i++) {
    const match = lines[i].match(CSV_ROW_RE);
    if (!match) continue;
    const [, src, tgt, sLang, tLang] = match;
    if (!src || !tgt || !sLang || !tLang) continue;
    const exists = entries.some(
      (g) =>
        g.source.toLowerCase() === src.toLowerCase() &&
        g.sourceLang === sLang &&
        g.targetLang === tLang
    );
    if (!exists) {
      entries.push({
        source: src,
        target: tgt,
        sourceLang: sLang,
        targetLang: tLang,
      });
      imported++;
    }
  }

  return { entries, imported };
}
