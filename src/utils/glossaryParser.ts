import type { GlossaryEntry } from "./glossaryValidation";

export interface GlossaryParseResult {
  entries: GlossaryEntry[];
  imported: number;
}

export function glossaryToCSV(entries: readonly GlossaryEntry[]): string {
  const header = "source,target,sourceLang,targetLang";
  if (entries.length === 0) return header;
  const body = entries
    .map(
      (g) =>
        `"${g.source.replace(/"/g, '""')}","${g.target.replace(/"/g, '""')}","${g.sourceLang}","${g.targetLang}"`
    )
    .join("\n");
  return header + "\n" + body;
}

function parseCSVRow(line: string): string[] | null {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      let val = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += line[i]; i++; }
      }
      fields.push(val);
      if (line[i] === ",") i++;
      else break;
    } else {
      const next = line.indexOf(",", i);
      if (next === -1) { fields.push(line.slice(i).trim()); break; }
      fields.push(line.slice(i, next).trim());
      i = next + 1;
    }
  }
  return fields.length >= 4 ? fields : null;
}

export function parseGlossaryCSV(
  csvText: string,
  existingEntries: readonly GlossaryEntry[]
): GlossaryParseResult {
  const lines = csvText.split("\n").filter((l) => l.trim());
  const start = lines[0]?.toLowerCase().startsWith("source") ? 1 : 0;
  let imported = 0;
  const entries: GlossaryEntry[] = [...existingEntries];

  for (let i = start; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    if (!fields) continue;
    const [src, tgt, sLang, tLang] = fields;
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
