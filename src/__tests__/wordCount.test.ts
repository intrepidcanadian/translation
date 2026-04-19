import { countWords } from "../utils/wordCount";

describe("countWords", () => {
  it("counts space-separated words", () => {
    expect(countWords("hello world")).toBe(2);
  });

  it("handles multiple whitespace types", () => {
    expect(countWords("one\ttwo\nthree")).toBe(3);
  });

  it("trims leading and trailing whitespace", () => {
    expect(countWords("  hello world  ")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(countWords("   \t\n  ")).toBe(0);
  });

  it("counts single word", () => {
    expect(countWords("hello")).toBe(1);
  });

  it("handles consecutive spaces", () => {
    expect(countWords("one   two   three")).toBe(3);
  });
});
