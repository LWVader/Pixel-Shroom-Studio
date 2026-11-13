import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function* sources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:m?js|cjs)$/.test(entry.name)) yield path;
  }
}

const files = [
  "worker.mjs",
  "gelato-catalog.mjs",
  ...["public", "tools", "mint-worker"].flatMap((dir) => [...sources(dir)]),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Checked syntax for ${files.length} source files.`);
