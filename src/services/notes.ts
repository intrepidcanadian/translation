// Notes storage service — saves scanned/translated documents as Markdown files
// Each note is a .md file with YAML frontmatter, LLM-parseable and portable

import { Paths, File, Directory } from "expo-file-system";
import type { ScannerModeKey } from "./scannerModes";

const NOTES_DIR_NAME = "notes";

export interface SavedNote {
  id: string;
  title: string;
  originalText: string;
  translatedText: string;
  formattedNote: string;
  scanMode: ScannerModeKey;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  fields: Array<{ label: string; value: string }>;
}

interface NoteIndex {
  id: string;
  title: string;
  scanMode: ScannerModeKey;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  fieldCount: number;
}

let indexCache: NoteIndex[] | null = null;
let noteCache = new Map<string, SavedNote>();

function getNotesDir(): Directory {
  return new Directory(Paths.document, NOTES_DIR_NAME);
}

function ensureDir(): void {
  const dir = getNotesDir();
  if (!dir.exists) {
    dir.create();
  }
}

function getIndexFile(): File {
  return new File(getNotesDir(), "index.json");
}

function getNoteFile(id: string): File {
  return new File(getNotesDir(), `${id}.md`);
}

// ---- Markdown serialization ----

function noteToMarkdown(note: SavedNote): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`id: ${note.id}`);
  lines.push(`title: "${note.title.replace(/"/g, '\\"')}"`);
  lines.push(`scan_mode: ${note.scanMode}`);
  lines.push(`source_lang: ${note.sourceLang}`);
  lines.push(`target_lang: ${note.targetLang}`);
  lines.push(`timestamp: ${note.timestamp}`);
  lines.push(`date: ${new Date(note.timestamp).toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${note.title}`);
  lines.push("");

  if (note.fields.length > 0) {
    lines.push("## Key Information");
    lines.push("");
    for (const f of note.fields) {
      lines.push(`- **${f.label}:** ${f.value}`);
    }
    lines.push("");
  }

  lines.push("## Translation");
  lines.push("");
  lines.push(note.translatedText);
  lines.push("");
  lines.push("## Original Text");
  lines.push("");
  lines.push(note.originalText);
  lines.push("");

  return lines.join("\n");
}

function markdownToNote(content: string, filename: string): SavedNote | null {
  try {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const get = (key: string): string => {
      const m = fm.match(new RegExp(`^${key}:\\s*"?(.*?)"?$`, "m"));
      return m ? m[1] : "";
    };

    const id = get("id") || filename.replace(".md", "");
    const title = get("title");
    const scanMode = (get("scan_mode") || "document") as ScannerModeKey;
    const sourceLang = get("source_lang") || "en";
    const targetLang = get("target_lang") || "en";
    const timestamp = parseInt(get("timestamp")) || Date.now();

    const body = content.slice(fmMatch[0].length);

    const fields: Array<{ label: string; value: string }> = [];
    const fieldsMatch = body.match(/## Key Information\n\n([\s\S]*?)(?=\n## |\n*$)/);
    if (fieldsMatch) {
      const fieldLines = fieldsMatch[1].trim().split("\n");
      for (const line of fieldLines) {
        const m = line.match(/^- \*\*(.+?):\*\*\s*(.+)$/);
        if (m) fields.push({ label: m[1], value: m[2] });
      }
    }

    const transMatch = body.match(/## Translation\n\n([\s\S]*?)(?=\n## |\n*$)/);
    const translatedText = transMatch ? transMatch[1].trim() : "";

    const origMatch = body.match(/## Original Text\n\n([\s\S]*?)$/);
    const originalText = origMatch ? origMatch[1].trim() : "";

    const formattedNote = body.trim();

    return {
      id, title, originalText, translatedText, formattedNote,
      scanMode, sourceLang, targetLang, timestamp, fields,
    };
  } catch {
    return null;
  }
}

function noteToIndex(note: SavedNote): NoteIndex {
  return {
    id: note.id,
    title: note.title,
    scanMode: note.scanMode,
    sourceLang: note.sourceLang,
    targetLang: note.targetLang,
    timestamp: note.timestamp,
    fieldCount: note.fields.length,
  };
}

async function loadIndex(): Promise<NoteIndex[]> {
  if (indexCache) return indexCache;
  ensureDir();
  try {
    const file = getIndexFile();
    if (file.exists) {
      const content = await file.text();
      indexCache = JSON.parse(content);
      return indexCache!;
    }
  } catch {}
  return rebuildIndex();
}

async function rebuildIndex(): Promise<NoteIndex[]> {
  ensureDir();
  try {
    const dir = getNotesDir();
    const items = dir.list();
    const entries: NoteIndex[] = [];

    for (const item of items) {
      if (item instanceof File && item.name.endsWith(".md")) {
        try {
          const content = await item.text();
          const note = markdownToNote(content, item.name);
          if (note) entries.push(noteToIndex(note));
        } catch {}
      }
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);
    indexCache = entries;
    saveIndexSync(entries);
    return entries;
  } catch {
    indexCache = [];
    return [];
  }
}

function saveIndexSync(index: NoteIndex[]): void {
  indexCache = index;
  ensureDir();
  const file = getIndexFile();
  file.write(JSON.stringify(index));
}

// ---- Public API ----

export async function loadNotes(): Promise<SavedNote[]> {
  const index = await loadIndex();
  const notes: SavedNote[] = [];

  for (const entry of index) {
    const cached = noteCache.get(entry.id);
    if (cached) {
      notes.push(cached);
      continue;
    }

    try {
      const file = getNoteFile(entry.id);
      if (file.exists) {
        const content = await file.text();
        const note = markdownToNote(content, file.name);
        if (note) {
          noteCache.set(note.id, note);
          notes.push(note);
        }
      }
    } catch {}
  }

  return notes;
}

export async function loadNoteById(id: string): Promise<SavedNote | null> {
  const cached = noteCache.get(id);
  if (cached) return cached;

  try {
    const file = getNoteFile(id);
    if (!file.exists) return null;
    const content = await file.text();
    const note = markdownToNote(content, file.name);
    if (note) noteCache.set(note.id, note);
    return note;
  } catch {
    return null;
  }
}

export async function saveNote(note: Omit<SavedNote, "id" | "timestamp">): Promise<SavedNote> {
  ensureDir();

  const newNote: SavedNote = {
    ...note,
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };

  const md = noteToMarkdown(newNote);
  const file = getNoteFile(newNote.id);
  file.write(md);

  const index = await loadIndex();
  const updated = [noteToIndex(newNote), ...index].slice(0, 200);
  saveIndexSync(updated);

  noteCache.set(newNote.id, newNote);
  return newNote;
}

export async function deleteNote(id: string): Promise<void> {
  try {
    const file = getNoteFile(id);
    if (file.exists) file.delete();
  } catch {}

  noteCache.delete(id);

  const index = await loadIndex();
  saveIndexSync(index.filter((n) => n.id !== id));
}

export async function updateNoteTitle(id: string, title: string): Promise<void> {
  const note = await loadNoteById(id);
  if (!note) return;

  const updated = { ...note, title };
  const md = noteToMarkdown(updated);
  const file = getNoteFile(id);
  file.write(md);

  noteCache.set(id, updated);

  const index = await loadIndex();
  const idx = index.findIndex((n) => n.id === id);
  if (idx !== -1) {
    index[idx] = { ...index[idx], title };
    saveIndexSync(index);
  }
}

export async function clearAllNotes(): Promise<void> {
  try {
    const dir = getNotesDir();
    if (dir.exists) dir.delete();
  } catch {}
  noteCache.clear();
  indexCache = null;
  ensureDir();
  saveIndexSync([]);
}

export function invalidateCache(): void {
  indexCache = null;
  noteCache.clear();
}

export function getNotesDirectory(): string {
  return getNotesDir().uri;
}
