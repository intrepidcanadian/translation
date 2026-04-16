/**
 * Unit tests for the pure URL-generator helpers in
 * `services/productLookup.ts` — `getMarketplaceLinks` and
 * `getPriceCompLinks`.
 *
 * Why pin these:
 *  - These two helpers build the deep-link URLs the user taps from the
 *    product detail screen to jump into Amazon, eBay, Walmart, etc. A
 *    bug here can manifest as:
 *      • a URL that doesn't load (encoding error)
 *      • a URL that loads the wrong product (lost query)
 *      • a URL that opens an attacker-controlled page (an unescaped
 *        product name with `&` or `?` could smuggle extra query params
 *        into a marketplace URL)
 *  - The fix in all cases is `encodeURIComponent` on the query, which
 *    is what the implementation does today. Pin that contract so a
 *    future refactor (e.g. swapping in a `URL` builder, or "cleaning
 *    up" the literal templates) doesn't accidentally drop encoding.
 *  - Pinning the marketplace list also catches accidental removals —
 *    these helpers feed UI menus and a missing entry would silently
 *    drop a marketplace from the picker. Adding a new marketplace is a
 *    deliberate decision and updating these tests is the right tax.
 *
 * The fetch-based functions (`lookupBarcode`, `searchProductByText`,
 * `fetchPriceComps`) are intentionally NOT covered — they hit external
 * APIs and the right test surface is integration / contract tests with
 * recorded fixtures, not unit tests.
 */
import { getMarketplaceLinks, getPriceCompLinks } from "../services/productLookup";

describe("productLookup URL helpers", () => {
  describe("getMarketplaceLinks", () => {
    it("returns the four expected marketplace entries in order", () => {
      // Pin both the count and the names. If a UI change adds a fifth
      // marketplace, this test is the place to also update the picker
      // copy and analytics events.
      const links = getMarketplaceLinks("test product");
      expect(links).toHaveLength(4);
      expect(links.map((l) => l.name)).toEqual([
        "Amazon",
        "eBay",
        "Google Shopping",
        "Walmart",
      ]);
    });

    it("each entry has a non-empty icon and url", () => {
      const links = getMarketplaceLinks("widget");
      for (const link of links) {
        expect(link.icon.length).toBeGreaterThan(0);
        expect(link.url.length).toBeGreaterThan(0);
        expect(link.url.startsWith("https://")).toBe(true);
      }
    });

    it("URL-encodes spaces in the product name", () => {
      // `encodeURIComponent` turns ' ' into '%20'. A regression that
      // dropped the encoding would leave the literal space in the URL,
      // which most marketplaces accept but which breaks copy-paste and
      // analytics.
      const links = getMarketplaceLinks("apple iphone 13");
      for (const link of links) {
        expect(link.url).toContain("apple%20iphone%2013");
        expect(link.url).not.toContain("apple iphone 13");
      }
    });

    it("URL-encodes `&` and `=` so they don't smuggle extra query params", () => {
      // Critical safety check: an unescaped `&` would let an OCR'd
      // product name like "shoes&utm_source=evil" inject a fake utm
      // parameter into the outbound URL. encodeURIComponent maps `&`
      // → `%26` and `=` → `%3D`, which keeps the literal characters
      // inside the search-term value.
      const links = getMarketplaceLinks("shoes&utm_source=foo");
      for (const link of links) {
        expect(link.url).toContain("%26utm_source%3Dfoo");
        // Defensive: assert the literal `&utm_source=` substring is
        // NOT present anywhere after the first `?` query-marker.
        const queryStart = link.url.indexOf("?");
        const querySegment = link.url.slice(queryStart);
        expect(querySegment).not.toContain("&utm_source=foo");
      }
    });

    it("URL-encodes Unicode characters (CJK, accented Latin, emoji)", () => {
      // OCR can pull non-ASCII product names. encodeURIComponent uses
      // UTF-8 percent encoding, which is the universal marketplace
      // expectation. Test all three character classes to catch a
      // partial-encoding regression.
      const links = getMarketplaceLinks("カメラ café 📷");
      for (const link of links) {
        // Should NOT contain the raw multi-byte chars in the URL.
        expect(link.url).not.toContain("カメラ");
        expect(link.url).not.toContain("café");
        expect(link.url).not.toContain("📷");
        // Should contain percent-encoded bytes.
        expect(link.url).toMatch(/%[0-9A-F]{2}/);
      }
    });

    it("handles the empty string without throwing", () => {
      // Defensive: callers may pass an empty product name when OCR
      // failed. The helper should still produce four URLs (which load
      // empty result pages on each marketplace) rather than crash.
      const links = getMarketplaceLinks("");
      expect(links).toHaveLength(4);
      for (const link of links) {
        expect(typeof link.url).toBe("string");
      }
    });
  });

  describe("getPriceCompLinks", () => {
    it("returns the four expected price-comp entries in order", () => {
      // The order matters — the UI shows "eBay Sold" first because
      // sold listings are the most reliable resale-value signal. Pin
      // the order so a refactor doesn't silently demote it.
      const links = getPriceCompLinks("vintage camera");
      expect(links).toHaveLength(4);
      expect(links.map((l) => l.name)).toEqual([
        "eBay Sold",
        "eBay Active",
        "Amazon",
        "Google Shopping",
      ]);
    });

    it("each entry has a non-empty description", () => {
      // The description renders as a help-text line under each link.
      // A regression that dropped one would leave a visually broken
      // row in the UI.
      const links = getPriceCompLinks("widget");
      for (const link of links) {
        expect(link.description.length).toBeGreaterThan(0);
      }
    });

    it("the eBay Sold link includes the LH_Complete=1 and LH_Sold=1 filters", () => {
      // These two query params are what restricts the search to
      // *completed* sold listings, which is the entire point of the
      // "Sold" link. A regression that drops them would silently
      // return active-listing results instead.
      const [sold] = getPriceCompLinks("watch");
      expect(sold.url).toContain("LH_Complete=1");
      expect(sold.url).toContain("LH_Sold=1");
    });

    it("encodes the query parameter the same way as getMarketplaceLinks", () => {
      // The two helpers must apply identical encoding to the query so
      // a product that works in one menu also works in the other. A
      // divergence would be confusing user-facing inconsistency.
      const market = getMarketplaceLinks("nikon d750");
      const comps = getPriceCompLinks("nikon d750");
      const marketAmazon = market.find((l) => l.name === "Amazon")!;
      const compsAmazon = comps.find((l) => l.name === "Amazon")!;
      expect(marketAmazon.url).toBe(compsAmazon.url);
    });

    it("URL-encodes special characters in the query", () => {
      const links = getPriceCompLinks("a&b=c");
      for (const link of links) {
        // The query value should appear percent-encoded.
        expect(link.url).toContain("a%26b%3Dc");
      }
    });
  });
});
