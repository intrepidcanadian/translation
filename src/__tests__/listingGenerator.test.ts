/**
 * Unit tests for the synchronous listing generation paths in
 * `services/listingGenerator.ts` — `generateListing` and
 * `formatListingForShare`.
 *
 * Why pin these:
 *  - `generateListing` is the offline / fallback path used whenever the
 *    Apple Neural Engine smart-listing analyzer is unavailable (Android, old
 *    iOS, or when the smart path throws). It exercises the two private
 *    helpers `detectCategory` and `extractBrandModel`, which are otherwise
 *    untested. Both contain hand-tuned keyword/brand lists that are easy to
 *    break by accident — a typo in the regex word boundary, a missing brand
 *    in the list, or a mis-ordered category check (electronics before sports
 *    matters because "iphone" is in electronics and "yoga" is in sports — a
 *    fixture that contains both should get whichever category the array
 *    visits first).
 *  - `formatListingForShare` is the user-visible "copy to clipboard"
 *    serializer for a listing draft. It produces the literal string the user
 *    pastes into Facebook Marketplace, OfferUp, etc. — a layout regression
 *    here goes straight to the user's clipboard. Locking the contract
 *    protects against accidental separator/header changes.
 *
 * The smart (async) path is intentionally NOT covered: it depends on the
 * Apple Neural Engine bridge, which jest-expo cannot exercise. The fallback
 * inside `generateSmartListing` calls `generateListing`, so the safety net
 * for that path is the same coverage as below.
 */
import { generateListing, formatListingForShare, detectCategory } from "../services/listingGenerator";

describe("listingGenerator", () => {
  describe("generateListing — category detection", () => {
    it("detects electronics from product OCR text", () => {
      const draft = generateListing("Apple iPhone 13 Pro 256GB Space Gray", "good");
      expect(draft.category).toBe("electronics");
    });

    it("detects clothing from product OCR text", () => {
      const draft = generateListing("Nike Air Max sneakers size 10", "like_new");
      expect(draft.category).toBe("clothing");
    });

    it("detects furniture from product OCR text", () => {
      const draft = generateListing("IKEA POÄNG armchair birch veneer", "good");
      expect(draft.category).toBe("furniture");
    });

    it("detects books from product OCR text", () => {
      const draft = generateListing("The Great Gatsby paperback edition", "fair");
      expect(draft.category).toBe("books");
    });

    it("detects toys from product OCR text", () => {
      const draft = generateListing("LEGO Star Wars Millennium Falcon set", "new");
      expect(draft.category).toBe("toys");
    });

    it("detects sports from product OCR text", () => {
      const draft = generateListing("Wilson tennis racket pro staff", "good");
      expect(draft.category).toBe("sports");
    });

    it("detects home from product OCR text", () => {
      const draft = generateListing("Dyson V15 vacuum cleaner cordless", "like_new");
      // "vacuum" and "dyson" both match — Dyson is in the brands list and
      // "vacuum" is in the home keyword list. The category result depends
      // only on the regex match, not on brand detection.
      expect(draft.category).toBe("home");
    });

    it("detects auto from product OCR text", () => {
      const draft = generateListing("Michelin tire 225/45R17 brand new", "new");
      expect(draft.category).toBe("auto");
    });

    it('falls back to "other" when no keywords match', () => {
      const draft = generateListing("zzz qqq xyz nothing relevant here", "good");
      expect(draft.category).toBe("other");
    });

    // ---- Salience scorer (#208) ----
    // The detector now picks the category with the MOST keyword hits, not
    // the first category in array order. These cases pin the behavior so a
    // regression to first-match-wins gets caught.
    it("picks the category with the highest keyword match count on multi-category collisions", () => {
      // 2 sports hits ("tennis", "racket") vs 1 electronics hint ("usb").
      // Under the old first-match-wins loop this returned "electronics";
      // the salience scorer must return "sports".
      expect(detectCategory("Wilson tennis racket with usb charging case")).toBe("sports");
    });

    it("breaks ties on array order so electronics wins a 1-vs-1 against clothing", () => {
      // Pure tie-break fence: 1 electronics hit ("iphone") + 1 clothing hit
      // ("shoes"). Electronics is earlier in the patterns array so it wins.
      // If this flips (e.g. someone reorders the array or swaps the tie-break
      // to "later match wins"), this test catches it.
      expect(detectCategory("iphone case and shoes")).toBe("electronics");
    });

    it("counts repeated keywords toward the salience score", () => {
      // Three separate book hints ("novel", "paperback", "edition") beat a
      // single electronics hint ("camera"). A naive Set-based dedupe would
      // break this case because it would count each category as "matched"
      // rather than scoring by hit count.
      expect(detectCategory("Paperback novel second edition — camera on cover")).toBe("books");
    });

    it("returns 'other' when no keyword matches at all", () => {
      // Bare contract for the scorer's fallback path.
      expect(detectCategory("a b c d")).toBe("other");
    });

    it("respects an explicit user-provided category over auto-detection", () => {
      // Pin the override contract: even if the OCR text screams "iPhone",
      // the user's explicit category wins. This is what powers the manual
      // category dropdown in the listing editor.
      const draft = generateListing("Apple iPhone 13", "good", undefined, "books");
      expect(draft.category).toBe("books");
    });

    // ---- Keyword corpus expansion (#210) ----
    // These cover the brand additions to the auto, home, and books
    // categories. The motivating real-world cases: a luxury car emblem
    // photo, a kitchen appliance brand label, and a publisher imprint
    // line on a book cover. Before the expansion these would all route
    // to "other" because none of the generic nouns in the text match.
    it("detects auto from a luxury car brand alone (no generic noun)", () => {
      // Pre-#210 this fixture had zero auto matches and would have routed
      // to "other" — the only previously-recognized auto hint was generic
      // car nouns. A photo of just a BMW emblem is now detectable.
      expect(detectCategory("BMW M3 Competition Coupe")).toBe("auto");
    });

    it("detects auto from a Toyota model with no generic car noun", () => {
      // Toyota Camry is one of the highest-volume listings on every used
      // marketplace — pre-#210 a "Toyota Camry XLE 2018" listing without
      // the word "car" routed to "other".
      expect(detectCategory("Toyota Camry XLE 2018")).toBe("auto");
    });

    it("detects auto from a multi-brand mention (collision-safe)", () => {
      // 2 auto hints (mercedes, bmw) → unambiguous auto. Tests that the
      // appended brands stack as expected through the salience scorer.
      expect(detectCategory("Mercedes vs BMW comparison report")).toBe("auto");
    });

    it("detects home from a KitchenAid stand mixer label", () => {
      // KitchenAid was already in the brands list but not the home
      // keyword regex — pre-#210 this had only "mixer" as a hit (1
      // home vote) and could be drowned out by other categories. With
      // the brand entry it now scores 2 votes and is unambiguous.
      expect(detectCategory("KitchenAid Artisan stand mixer 5qt")).toBe("home");
    });

    it("detects home from a Roomba model number alone", () => {
      // "Roomba i7" has no generic home noun — pre-#210 it routed to
      // "other". The robot vacuum category is high-volume on resale
      // marketplaces, so this is a real coverage gap that's now closed.
      expect(detectCategory("Roomba i7+ robot vacuum")).toBe("home");
    });

    it("detects books from an O'Reilly publisher imprint", () => {
      // Tech book covers carry the O'Reilly animal mark and the
      // publisher name without necessarily saying "book" or "edition".
      // The publisher-name additions catch this shape.
      expect(detectCategory("O'Reilly Designing Data-Intensive Applications")).toBe("books");
    });

    // ---- Regression fence: "ram" stays in electronics ----
    // The auto category deliberately omits "ram" (Dodge Ram) because
    // "ram" already lives in the electronics keyword list as the memory
    // unit. A misguided "tidy" PR that adds Dodge Ram by appending
    // "ram" to the auto regex would silently flip every "16GB RAM"
    // listing from electronics to a tied/wrong category. This fence
    // catches that.
    it("'ram' alone routes to electronics, not auto (memory vs Dodge Ram)", () => {
      expect(detectCategory("Apple MacBook 16GB RAM 512GB SSD")).toBe("electronics");
    });

    // ---- Regression fence: existing "Vintage handcrafted" stays "other" ----
    // The books keyword expansion deliberately omitted "vintage" because
    // Vintage Books is a real publisher imprint but the word is also a
    // common second-hand-listing adjective. Pin the no-collision contract.
    it("'vintage' as a generic adjective does NOT trigger the books category", () => {
      expect(detectCategory("Vintage handcrafted item")).toBe("other");
    });
  });

  describe("generateListing — brand & model extraction", () => {
    it("extracts a known brand from OCR text", () => {
      const draft = generateListing("Apple MacBook Pro 14 inch", "like_new");
      // The brand should land in the title. We don't expose the helper, but
      // the title is built from `${brand} ${model}` when neither is
      // user-provided, so this is the observable contract.
      expect(draft.title).toMatch(/Apple/);
    });

    it("extracts a model number using the alphanumeric pattern", () => {
      // The regex matches A2442 (Apple's MacBook Pro M1 Pro identifier shape).
      const draft = generateListing("Apple MacBook A2442", "good");
      expect(draft.title).toMatch(/A2442/);
    });

    it("includes brand in the suggestedTags list", () => {
      const draft = generateListing("Sony WH-1000XM4 headphones", "good");
      expect(draft.suggestedTags).toContain("sony");
    });

    it("appends the condition label to the auto-generated title for non-new items", () => {
      const draft = generateListing("Sony Bravia TV", "fair");
      expect(draft.title).toMatch(/- Fair$/);
    });

    it("does NOT append a condition suffix when condition is 'new'", () => {
      // A brand-new item shouldn't get "- New" tacked on the end — that's
      // redundant and looks odd in the title.
      const draft = generateListing("Sony WH-1000XM4 headphones", "new");
      expect(draft.title).not.toMatch(/- New$/);
    });

    it("uses the first meaningful OCR line when no brand or model is detected", () => {
      const draft = generateListing(
        "Vintage handcrafted item\nlots of details here\nand more lines",
        "good"
      );
      // No brand list match, no model regex match → first line wins.
      expect(draft.title).toMatch(/Vintage handcrafted item/);
    });

    it("respects a user-provided title and ignores extracted brand/model", () => {
      const draft = generateListing(
        "Apple iPhone 13 A2628",
        "good",
        "My Custom Title"
      );
      expect(draft.title).toBe("My Custom Title");
    });
  });

  describe("generateListing — description & tags", () => {
    it("includes the category icon and label in the description", () => {
      const draft = generateListing("Apple iPhone 13", "good");
      expect(draft.description).toContain("💻");
      expect(draft.description).toContain("Electronics");
    });

    it("includes the condition label in the description", () => {
      const draft = generateListing("Apple iPhone 13", "like_new");
      expect(draft.description).toContain("Condition: Like New");
    });

    it("dedupes the suggestedTags so the same tag never appears twice", () => {
      // The internal tag list pushes brand, model, category, condition, and
      // category-label — and category + category-label can collide when both
      // resolve to the same lowercased string. Pin the dedupe step so a
      // future refactor that drops the `arr.indexOf(t) === i` filter gets
      // caught.
      const draft = generateListing("Apple iPhone 13", "good");
      const seen = new Set(draft.suggestedTags);
      expect(seen.size).toBe(draft.suggestedTags.length);
    });

    it("limits product detail bullets to 10 to avoid overwhelming descriptions", () => {
      // OCR text from a busy package can have dozens of lines. The generator
      // caps the bullet list at 10; pin that so a refactor that swaps the
      // slice() for a different windowing function doesn't accidentally let
      // 50 lines through into the user's listing description.
      const lines = Array.from({ length: 30 }, (_, i) => `Detail line number ${i}`);
      const draft = generateListing(lines.join("\n"), "good");
      const bulletLines = draft.description.split("\n").filter((l) => l.startsWith("• "));
      expect(bulletLines.length).toBeLessThanOrEqual(10);
    });

    it("filters OCR lines that are too short or too long for the description", () => {
      // The implementation requires 5 < length < 200. Lines outside that
      // band should be dropped from the bullet list. Useful guard against
      // OCR garbage (single-character noise) and runaway paragraphs.
      const ocr = [
        "ok", // too short, dropped
        "good line that should appear",
        "x".repeat(250), // too long, dropped
      ].join("\n");
      const draft = generateListing(ocr, "good");
      const bullets = draft.description.split("\n").filter((l) => l.startsWith("• "));
      expect(bullets.some((b) => b.includes("good line that should appear"))).toBe(true);
      expect(bullets.some((b) => b.includes("ok"))).toBe(false);
      expect(bullets.some((b) => b.length > 250)).toBe(false);
    });

    it("always includes the photos disclaimer at the end of the description", () => {
      const draft = generateListing("Apple iPhone 13", "good");
      expect(draft.description).toContain("📸 Photos show actual item condition.");
    });
  });

  describe("formatListingForShare", () => {
    it("renders title, separator, and description for a minimal draft", () => {
      const out = formatListingForShare({
        title: "Sony WH-1000XM4",
        description: "Great headphones",
        category: "electronics",
        condition: "good",
        suggestedTags: [],
      });
      expect(out).toContain("Sony WH-1000XM4");
      expect(out).toContain("Great headphones");
      // Default separator is 30 box-drawing dashes.
      expect(out).toContain("─".repeat(30));
    });

    it("includes price and currency when provided", () => {
      const out = formatListingForShare({
        title: "iPhone",
        description: "desc",
        category: "electronics",
        condition: "good",
        suggestedTags: [],
        price: "499",
        currency: "$",
      });
      expect(out).toContain("💰 $499");
    });

    it('defaults the currency to "$" when only price is provided', () => {
      const out = formatListingForShare({
        title: "iPhone",
        description: "desc",
        category: "electronics",
        condition: "good",
        suggestedTags: [],
        price: "499",
      });
      expect(out).toContain("💰 $499");
    });

    it("renders tags as hashtag-style strings with whitespace stripped", () => {
      const out = formatListingForShare({
        title: "iPhone",
        description: "desc",
        category: "electronics",
        condition: "good",
        suggestedTags: ["like new", "apple", "smart phone"],
      });
      expect(out).toContain("#likenew");
      expect(out).toContain("#apple");
      expect(out).toContain("#smartphone");
    });

    it("omits the tags line entirely when there are no tags", () => {
      const out = formatListingForShare({
        title: "iPhone",
        description: "desc",
        category: "electronics",
        condition: "good",
        suggestedTags: [],
      });
      expect(out).not.toContain("Tags:");
    });

    it("includes translations only when the includeTranslation flag is true", () => {
      const draft = {
        title: "iPhone",
        description: "desc",
        category: "electronics" as const,
        condition: "good" as const,
        suggestedTags: [],
        translatedTitle: "苹果手机",
        translatedDescription: "描述",
        targetLang: "zh",
      };
      const without = formatListingForShare(draft, false);
      const withTr = formatListingForShare(draft, true);
      expect(without).not.toContain("苹果手机");
      expect(withTr).toContain("苹果手机");
      expect(withTr).toContain("描述");
      expect(withTr).toContain("ZH");
    });

    it("does NOT include the translation block when flag is true but translations are missing", () => {
      // Defensive guard: passing includeTranslation=true on a draft that
      // hasn't been through translateListing() should not crash and should
      // not render a half-empty translation header.
      const out = formatListingForShare(
        {
          title: "iPhone",
          description: "desc",
          category: "electronics",
          condition: "good",
          suggestedTags: [],
        },
        true
      );
      expect(out).not.toContain("🌐");
    });
  });
});
