import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildStatic } from "../../tools/build-static.mjs";
it("minifies deployment code while preserving source, module URLs and other assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pixel-build-"));
  const source = path.join(root, "source"),
    output = path.join(root, "output");
  try {
    await fs.mkdir(source);
    const files = {
      "core.js": "export function total(a, b) { return a + b; }\n",
      "app.js": 'import { total } from "./core.js";\nwindow.answer = total(2, 3);\n',
      "style.css": ".card { color: #ffffff; padding: 0px 0px 0px 0px; }\n",
      "index.html":
        '<script type="module" src="/app.js"></script><link rel="stylesheet" href="/style.css">',
      "robots.txt": "User-agent: *\nAllow: /\n",
      "llms.txt": "# Pixel Shroom Studio\n\n> Studio overview.\n",
    };
    for (const [file, text] of Object.entries(files))
      await fs.writeFile(path.join(source, file), text);
    const result = await buildStatic(source, output);
    expect(result.after).toBeLessThan(result.before);
    expect(result.minified).toBe(3);
    for (const [file, text] of Object.entries(files))
      expect(await fs.readFile(path.join(source, file), "utf8")).toBe(text);
    for (const file of ["index.html", "robots.txt", "llms.txt"])
      expect(await fs.readFile(path.join(output, file), "utf8")).toBe(files[file]);
    expect(await fs.readFile(path.join(output, "app.js"), "utf8")).toContain('"./core.js"');
    const core = await import("file://" + path.join(output, "core.js"));
    expect(core.total(2, 3)).toBe(5);
    await fs.writeFile(path.join(output, "stale.js"), "stale");
    await buildStatic(source, output);
    await expect(fs.stat(path.join(output, "stale.js"))).rejects.toThrow();
    await expect(buildStatic(source, source)).rejects.toThrow("separate");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
