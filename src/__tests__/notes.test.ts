/**
 * Unit tests for the Markdown serialization layer in `services/notes.ts`.
 *
 * Why pin this:
 *  - `noteToMarkdown` and `markdownToNote` are the persistence codec for
 *    every scanned document. If serialization produces invalid YAML
 *    frontmatter, or deserialization silently drops a field, the user
 *    loses data the next time they open a saved note.
 *  - The frontmatter parser uses a regex (`^${key}:\\s*"?(.*?)"?$`) that
 *    is sensitive to quoting, colons in values, and multiline content.
 *    The round-trip tests pin that the write → read cycle is lossless
 *    for every field the app cares about.
 *  - Edge cases: titles with quotes, empty fields, notes with no Key
 *    Information section, and the fallback defaults in markdownToNote
 *    (id from filename, default scanMode/sourceLang/targetLang).
 */

import { noteToMarkdown, markdownToNote, type SavedNote } from "../services/notes";

function makeNote(overrides: Partial<SavedNote> = {}): SavedNote {
  return {
    id: "note_1713300000000_abc123",
    title: "Test Document",
    originalText: "Bonjour le monde",
    translatedText: "Hello world",
    formattedNote: "",
    scanMode: "document",
    sourceLang: "fr",
    targetLang: "en",
    timestamp: 1713300000000,
    fields: [],
    ...overrides,
  };
}

describe("notes serialization", () => {
  describe("noteToMarkdown", () => {
    it("produces valid YAML frontmatter delimiters", () => {
      const md = noteToMarkdown(makeNote());
      expect(md.startsWith("---\n")).toBe(true);
      expect(md).toContain("\n---\n");
    });

    it("includes all frontmatter keys", () => {
      const md = noteToMarkdown(makeNote());
      expect(md).toContain("id: note_1713300000000_abc123");
      expect(md).toContain('title: "Test Document"');
      expect(md).toContain("scan_mode: document");
      expect(md).toContain("source_lang: fr");
      expect(md).toContain("target_lang: en");
      expect(md).toContain("timestamp: 1713300000000");
      expect(md).toContain("date: ");
    });

    it("renders a Markdown heading with the title", () => {
      const md = noteToMarkdown(makeNote({ title: "My Scan" }));
      expect(md).toContain("# My Scan");
    });

    it("renders Key Information section when fields are present", () => {
      const md = noteToMarkdown(makeNote({
        fields: [
          { label: "Total", value: "$42.00" },
          { label: "Tax", value: "$3.50" },
        ],
      }));
      expect(md).toContain("## Key Information");
      expect(md).toContain("- **Total:** $42.00");
      expect(md).toContain("- **Tax:** $3.50");
    });

    it("omits Key Information section when fields are empty", () => {
      const md = noteToMarkdown(makeNote({ fields: [] }));
      expect(md).not.toContain("## Key Information");
    });

    it("renders Translation and Original Text sections", () => {
      const md = noteToMarkdown(makeNote({
        translatedText: "Hello world",
        originalText: "Bonjour le monde",
      }));
      expect(md).toContain("## Translation\n\nHello world");
      expect(md).toContain("## Original Text\n\nBonjour le monde");
    });

    it("escapes double quotes in the title", () => {
      const md = noteToMarkdown(makeNote({ title: 'He said "hello"' }));
      expect(md).toContain('title: "He said \\"hello\\""');
    });
  });

  describe("markdownToNote", () => {
    it("parses frontmatter fields correctly", () => {
      const md = noteToMarkdown(makeNote());
      const parsed = markdownToNote(md, "note_1713300000000_abc123.md");
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe("note_1713300000000_abc123");
      expect(parsed!.title).toBe("Test Document");
      expect(parsed!.scanMode).toBe("document");
      expect(parsed!.sourceLang).toBe("fr");
      expect(parsed!.targetLang).toBe("en");
      expect(parsed!.timestamp).toBe(1713300000000);
    });

    it("parses Key Information fields", () => {
      const md = noteToMarkdown(makeNote({
        fields: [
          { label: "Receipt Total", value: "€123.45" },
          { label: "Date", value: "2026-04-16" },
        ],
      }));
      const parsed = markdownToNote(md, "test.md");
      expect(parsed).not.toBeNull();
      expect(parsed!.fields).toHaveLength(2);
      expect(parsed!.fields[0]).toEqual({ label: "Receipt Total", value: "€123.45" });
      expect(parsed!.fields[1]).toEqual({ label: "Date", value: "2026-04-16" });
    });

    it("parses Translation and Original Text sections", () => {
      const md = noteToMarkdown(makeNote({
        translatedText: "Hello world",
        originalText: "Bonjour le monde",
      }));
      const parsed = markdownToNote(md, "test.md");
      expect(parsed).not.toBeNull();
      expect(parsed!.translatedText).toBe("Hello world");
      expect(parsed!.originalText).toBe("Bonjour le monde");
    });

    it("returns null for content without frontmatter", () => {
      expect(markdownToNote("No frontmatter here", "bad.md")).toBeNull();
    });

    it("returns null for malformed frontmatter", () => {
      expect(markdownToNote("---\n\n# No closing delimiter", "bad.md")).toBeNull();
    });

    it("falls back to filename for missing id", () => {
      const md = "---\ntitle: \"Test\"\n---\n\n## Translation\n\nHello\n\n## Original Text\n\nBonjour\n";
      const parsed = markdownToNote(md, "my_note.md");
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe("my_note");
    });

    it("falls back to default scanMode, sourceLang, targetLang", () => {
      const md = "---\nid: test\ntitle: \"Minimal\"\ntimestamp: 1713300000000\n---\n\n## Translation\n\nHi\n\n## Original Text\n\nHola\n";
      const parsed = markdownToNote(md, "test.md");
      expect(parsed).not.toBeNull();
      expect(parsed!.scanMode).toBe("document");
      expect(parsed!.sourceLang).toBe("en");
      expect(parsed!.targetLang).toBe("en");
    });

    it("handles notes with no Key Information section", () => {
      const md = noteToMarkdown(makeNote({ fields: [] }));
      const parsed = markdownToNote(md, "test.md");
      expect(parsed).not.toBeNull();
      expect(parsed!.fields).toEqual([]);
    });
  });

  describe("round-trip", () => {
    it("preserves all fields through noteToMarkdown → markdownToNote", () => {
      const original = makeNote({
        title: "Receipt Scan",
        originalText: "Montant total: 42,50 €\nTVA: 3,50 €",
        translatedText: "Total amount: €42.50\nVAT: €3.50",
        scanMode: "receipt",
        sourceLang: "fr",
        targetLang: "en",
        fields: [
          { label: "Total", value: "€42.50" },
          { label: "VAT", value: "€3.50" },
          { label: "Store", value: "Carrefour Paris" },
        ],
      });
      const md = noteToMarkdown(original);
      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.id).toBe(original.id);
      expect(restored!.title).toBe(original.title);
      expect(restored!.scanMode).toBe(original.scanMode);
      expect(restored!.sourceLang).toBe(original.sourceLang);
      expect(restored!.targetLang).toBe(original.targetLang);
      expect(restored!.timestamp).toBe(original.timestamp);
      expect(restored!.translatedText).toBe(original.translatedText);
      expect(restored!.originalText).toBe(original.originalText);
      expect(restored!.fields).toEqual(original.fields);
    });

    it("round-trips a title with escaped quotes", () => {
      const original = makeNote({ title: 'He said "hello" and "goodbye"' });
      const md = noteToMarkdown(original);
      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.title).toBe(original.title);
    });

    it("round-trips multiline original and translated text", () => {
      const original = makeNote({
        originalText: "Line one\nLine two\nLine three",
        translatedText: "Ligne un\nLigne deux\nLigne trois",
      });
      const md = noteToMarkdown(original);
      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.originalText).toBe(original.originalText);
      expect(restored!.translatedText).toBe(original.translatedText);
    });

    it("round-trips a note with empty translated and original text", () => {
      const original = makeNote({ translatedText: "", originalText: "" });
      const md = noteToMarkdown(original);
      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.translatedText).toBe("");
      expect(restored!.originalText).toBe("");
    });
  });

  describe("field value sanitization", () => {
    it("collapses embedded newlines in field values to spaces", () => {
      // OCR-extracted fields can contain line breaks from the source text.
      // Without sanitization, a newline inside a value would break the
      // per-line field regex in markdownToNote, silently dropping the
      // second line of the value.
      const original = makeNote({
        fields: [{ label: "Address", value: "123 Main St\nSuite 400\nNew York" }],
      });
      const md = noteToMarkdown(original);
      // The serialized markdown must keep the value on a single line.
      expect(md).toContain("- **Address:** 123 Main St Suite 400 New York");
      expect(md).not.toContain("Suite 400\n");

      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.fields).toHaveLength(1);
      expect(restored!.fields[0].value).toBe("123 Main St Suite 400 New York");
    });

    it("collapses embedded newlines in field labels to spaces", () => {
      const original = makeNote({
        fields: [{ label: "Recipient\nName", value: "Alice" }],
      });
      const md = noteToMarkdown(original);
      expect(md).toContain("- **Recipient Name:** Alice");

      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.fields[0].label).toBe("Recipient Name");
    });

    it("prevents field value containing '## ' from corrupting section parsing", () => {
      // The critical regression case: a value like "see ## Translation"
      // would (without sanitization) inject a markdown heading that
      // terminates the Key Information section's regex early and
      // corrupts the Translation section match.
      const original = makeNote({
        fields: [{ label: "Note", value: "Check section\n## Translation\nfor details" }],
        translatedText: "This is the real translation",
        originalText: "Este es el texto original",
      });
      const md = noteToMarkdown(original);

      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      // The Translation section must contain the real translation, not
      // the injected heading from the field value.
      expect(restored!.translatedText).toBe("This is the real translation");
      expect(restored!.originalText).toBe("Este es el texto original");
      // The field value is sanitized (newlines collapsed to spaces).
      expect(restored!.fields[0].value).toBe("Check section ## Translation for details");
    });

    it("handles \\r\\n (Windows-style) line endings in field values", () => {
      const original = makeNote({
        fields: [{ label: "Info", value: "Line one\r\nLine two\r\nLine three" }],
      });
      const md = noteToMarkdown(original);
      expect(md).toContain("- **Info:** Line one Line two Line three");
    });

    it("trims leading and trailing whitespace from field values", () => {
      const original = makeNote({
        fields: [{ label: "Total", value: "  $42.50  \n  " }],
      });
      const md = noteToMarkdown(original);
      expect(md).toContain("- **Total:** $42.50");
    });

    it("preserves field values that have no newlines (no-op sanitization)", () => {
      const original = makeNote({
        fields: [
          { label: "Price", value: "€42.50" },
          { label: "Store", value: "Carrefour Paris" },
        ],
      });
      const md = noteToMarkdown(original);
      const restored = markdownToNote(md, `${original.id}.md`);
      expect(restored).not.toBeNull();
      expect(restored!.fields).toEqual(original.fields);
    });
  });
});
