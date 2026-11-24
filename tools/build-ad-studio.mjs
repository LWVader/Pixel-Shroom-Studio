import {build} from "esbuild";
import {copyFile, mkdir, readFile, readdir, unlink, writeFile} from "node:fs/promises";
import {relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const studio = resolve(root, "public/admin-ad-studio");
const output = resolve(studio, "dist");
await mkdir(output, {recursive: true});
const shared = {absWorkingDir: studio, bundle: true, minify: true, outdir: output,
  entryNames: "[name]-[hash]", assetNames: "[name]-[hash]", metafile: true, legalComments: "inline"};
const script = await build({...shared, entryPoints: ["app.js"], format: "esm", target: "es2022"});
const style = await build({...shared, stdin: {contents: '@import "@fontsource/noto-emoji/emoji-400.css"; @import "./style.css";',
  resolveDir: studio, loader: "css", sourcefile: "studio.css"}, loader: {".woff2": "file", ".woff": "file"}});
function entry(result, extension) {
  const path = Object.entries(result.metafile.outputs).find(([file, meta]) => meta.entryPoint && file.endsWith(extension))?.[0];
  if (!path) throw Error("AD Studio build did not produce " + extension);
  return relative(studio, resolve(studio, path)).split(/[\\/]/).join("/");
}
const htmlPath = resolve(studio, "index.html");
let html = await readFile(htmlPath, "utf8");
const tags = {
  styles: '<link rel="stylesheet" href="' + entry(style, ".css") + '">',
  script: '<script type="module" src="' + entry(script, ".js") + '"></script>'
};
for (const [name, markup] of Object.entries(tags)) {
  const marker = new RegExp("<!-- studio-" + name + " -->.*?<!-- /studio-" + name + " -->", "s");
  if (!marker.test(html)) throw Error("Missing AD Studio asset marker " + name);
  html = html.replace(marker, "<!-- studio-" + name + " -->" + markup + "<!-- /studio-" + name + " -->");
}
await writeFile(htmlPath, html);
await copyFile(resolve(root, "node_modules/@fontsource/noto-emoji/LICENSE"), resolve(output, "Noto-Emoji-OFL.txt"));
const license = await readdir(resolve(root, "node_modules/mp4-muxer"));
const licensePath = license.find(name => /^license/i.test(name));
if (licensePath) await copyFile(resolve(root, "node_modules/mp4-muxer", licensePath), resolve(output, "mp4-muxer-LICENSE.txt"));

const generated = new Set([script, style].flatMap(result => Object.keys(result.metafile.outputs)
  .map(file => relative(output, resolve(studio, file)))));
for (const name of await readdir(output)) {
  if (/^(?:app|stdin|noto-emoji-emoji-400-normal)-[A-Z0-9]{8}\.(?:js|css|woff2?)$/.test(name) && !generated.has(name)) {
    await unlink(resolve(output, name));
  }
}
