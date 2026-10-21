import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve(process.argv[2] || "private-mint-keys");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
fs.writeFileSync(
  path.join(dir, "mint-private.pem"),
  privateKey.export({ format: "pem", type: "pkcs8" }),
  { mode: 0o600, flag: "wx" },
);
fs.writeFileSync(
  path.join(dir, "mint-public.pem"),
  publicKey.export({ format: "pem", type: "spki" }),
  { mode: 0o644, flag: "wx" },
);
console.log("Mint signing keys created. Keep the private PEM on the rendering server only.");
