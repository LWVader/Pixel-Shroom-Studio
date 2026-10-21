import { readFileSync, readdirSync } from "node:fs";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
const read = (name) => load(readFileSync(`public/${name}`, "utf8"));
const text = (value) => value.replace(/\s+/g, " ").trim();
describe("customer information matches edition delivery", () => {
  for (const file of ["faq.html", "usage-rights.html", "index.html"])
    it(`${file} structured answers match the visible FAQ`, () => {
      const $ = read(file);
      const visible = new Map(
        $("main details")
          .toArray()
          .map((node) => [text($(node).find("summary").text()), text($(node).find("p").text())]),
      );
      const faqs = [];
      $('script[type="application/ld+json"]').each((i, node) => {
        const data = JSON.parse($(node).text());
        faqs.push(...(data["@graph"] || [data]).filter((item) => item["@type"] === "FAQPage"));
      });
      expect(faqs).toHaveLength(1);
      for (const question of faqs[0].mainEntity)
        expect(visible.get(question.name)).toBe(question.acceptedAnswer.text);
    });
  it("discloses payment timing, prepared files, retries and existing permissions", () => {
    const $ = read("faq.html");
    const body = text($("main").text());
    for (const term of [
      "Standard",
      "Silver",
      "Gold",
      "Emerald",
      "Sapphire",
      "Prismatic",
      "after verified payment",
      "signed JSON receipt",
      "same edition number",
      "Copy-identification metadata",
      "does not include the private master",
      "redistribution and resale",
      "no new rarity roll",
      "eBay",
    ])
      expect(body).toContain(term);
    expect($(".faq details").length).toBeGreaterThanOrEqual(20);
  });
  it("preserves nine genre pages and separates edition verification from originals", () => {
    for (const file of readdirSync("public").filter((name) => name.endsWith(".html"))) {
      const $ = read(file);
      if (!$(".category-nav").length) continue;
      expect($(".category-nav a[href^='/genre.html?genre=']")).toHaveLength(9);
    }
    expect(read("verify.html")('a[href="/verify-mint.html"]').length).toBeGreaterThan(0);
    expect(read("verify-mint.html")('a[href="/verify.html"]').length).toBeGreaterThan(0);
    expect(read("index.html")("#catalog").attr("data-mode")).toBe("latest");
  });
});
