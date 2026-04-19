import { parseGlossaryCSV } from "../utils/glossaryParser";

describe("parseGlossaryCSV", () => {
  it("parses basic CSV rows", () => {
    const csv = "hello,hola,en,es\ngoodbye,adiós,en,es";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(2);
    expect(result.entries).toEqual([
      { source: "hello", target: "hola", sourceLang: "en", targetLang: "es" },
      { source: "goodbye", target: "adiós", sourceLang: "en", targetLang: "es" },
    ]);
  });

  it("skips header row when present", () => {
    const csv = "source,target,sourceLang,targetLang\nhello,hola,en,es";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(1);
    expect(result.entries[0].source).toBe("hello");
  });

  it("handles quoted fields", () => {
    const csv = '"hello, world","hola, mundo","en","es"';
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(1);
    expect(result.entries[0].source).toBe("hello, world");
  });

  it("deduplicates against existing entries (case-insensitive source)", () => {
    const existing = [
      { source: "Hello", target: "Hola", sourceLang: "en", targetLang: "es" },
    ];
    const csv = "hello,bonjour,en,es\nworld,mundo,en,es";
    const result = parseGlossaryCSV(csv, existing);
    expect(result.imported).toBe(1);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1].source).toBe("world");
  });

  it("deduplicates within the CSV itself", () => {
    const csv = "hello,hola,en,es\nhello,bonjour,en,es";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(1);
    expect(result.entries[0].target).toBe("hola");
  });

  it("allows same source in different language pairs", () => {
    const csv = "hello,hola,en,es\nhello,bonjour,en,fr";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(2);
  });

  it("skips rows with missing fields", () => {
    const csv = "hello,,en,es\n,hola,en,es\nhello,hola,,es\nhello,hola,en,";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("skips malformed rows", () => {
    const csv = "this is not csv\nhello,hola,en,es\nalso bad";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(1);
  });

  it("skips blank lines", () => {
    const csv = "hello,hola,en,es\n\n\nworld,mundo,en,es\n  \n";
    const result = parseGlossaryCSV(csv, []);
    expect(result.imported).toBe(2);
  });

  it("returns zero imported for empty input", () => {
    const result = parseGlossaryCSV("", []);
    expect(result.imported).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("preserves existing entries in output", () => {
    const existing = [
      { source: "cat", target: "gato", sourceLang: "en", targetLang: "es" },
    ];
    const csv = "dog,perro,en,es";
    const result = parseGlossaryCSV(csv, existing);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual(existing[0]);
  });
});
