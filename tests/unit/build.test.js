import { it, expect } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { load } from "cheerio";
it("parses every browser, Worker and local signing JavaScript module", () => {
  const files = fs
    .readdirSync("public")
    .filter((x) => /\.js$/.test(x))
    .map((x) => "public/" + x);
  files.push("worker.mjs", "tools/local-signing-server.mjs");
  for (const file of files)
    expect(
      () => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }),
      file,
    ).not.toThrow();
});
it("resolves local HTML links, scripts, styles and image assets", () => {
  const files = fs
    .readdirSync("public")
    .filter((x) => x.endsWith(".html"))
    .map((x) => "public/" + x)
    .concat(fs.readdirSync("public/genres").map((x) => "public/genres/" + x));
  for (const file of files) {
    const $ = load(fs.readFileSync(file, "utf8"));
    for (const el of $("[href],[src]").toArray()) {
      const raw = $(el).attr("href") || $(el).attr("src");
      if (!raw || /^(https?:|mailto:|tel:|data:|#)/.test(raw)) continue;
      const target = raw.split(/[?#]/)[0];
      if (!target || target === "/") continue;
      expect(
        fs.existsSync(
          target.startsWith("/") ? "public" + target : path.resolve(path.dirname(file), target),
        ),
        file + " -> " + raw,
      ).toBe(true);
    }
  }
});
it("keeps sitemap constrained to the supported nine genre URLs", () => {
  const xml = fs.readFileSync("public/sitemap.xml", "utf8");
  const genreURLs = [...xml.matchAll(/genre\.html\?genre=([^<]+)/g)].map((x) => x[1]);
  expect(genreURLs.sort()).toEqual(
    [
      "portrait",
      "fantasy",
      "landscape",
      "sci-fi",
      "abstract",
      "dreamscape",
      "dark-fantasy",
      "horror",
      "nft",
    ].sort(),
  );
});
