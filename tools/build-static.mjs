// Preserve readable source files; minify a separate deployment copy.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export async function buildStatic(
  source = path.join(projectRoot, "public"),
  output = path.join(projectRoot, "dist/public"),
) {
  source = path.resolve(source);
  output = path.resolve(output);
  if (
    source === output ||
    source.startsWith(output + path.sep) ||
    output.startsWith(source + path.sep)
  )
    throw new Error("Source and generated output must be separate directories");
  const files = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Public assets must not contain symbolic links");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(path.relative(source, absolute));
    }
  }
  await walk(source);
  // Transform everything before replacing the previous successful build.
  const transformed = new Map();
  let before = 0,
    after = 0;
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (![".js", ".mjs", ".css"].includes(extension)) continue;
    const text = await fs.readFile(path.join(source, file), "utf8");
    const result = await transform(text, {
      loader: extension === ".css" ? "css" : "js",
      sourcefile: file,
      minify: true,
      target: "es2022",
      legalComments: "inline",
      sourcemap: false,
    });
    transformed.set(file, result.code);
    before += Buffer.byteLength(text);
    after += Buffer.byteLength(result.code);
  }
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  for (const file of files) {
    const destination = path.join(output, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (transformed.has(file)) await fs.writeFile(destination, transformed.get(file));
    else await fs.copyFile(path.join(source, file), destination);
  }
  return { files: files.length, minified: transformed.size, before, after };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildStatic();
  console.log(
    `Built ${result.files} assets in dist/public. ${result.minified} JS/CSS files: ${result.before} → ${result.after} bytes. Source files unchanged.`,
  );
}
