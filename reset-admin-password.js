// SECTION: Runtime dependencies
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
// SECTION: Environment and requested administrator credentials
const root = resolve(import.meta.dirname);
const envPath = resolve(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
const email = String(process.argv[2] || process.env.ADMIN_EMAIL || "phantasmocazdor@gmail.com").trim().toLowerCase();
const password = String(process.argv[3] || process.env.ADMIN_PASSWORD || "password");
const databasePath = resolve(root, "artvault.sqlite");
// SECTION: Password hashing and database-only credential reset
if (!existsSync(databasePath)) {
  console.error("Database not found. Run node server.js once, stop it with Ctrl+C, then run this reset again.");
  process.exitCode = 1;
} else if (password.length < 8) {
  console.error("Password must contain at least 8 characters.");
  process.exitCode = 1;
} else {
  const db = new DatabaseSync(databasePath);
  const salt = randomBytes(16).toString("hex"), hash = pbkdf2Sync(password, salt, 1e5, 32, "sha256").toString("hex");
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO admins(email,password_hash,password_salt) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash,password_salt=excluded.password_salt").run(email, hash, salt);
    db.prepare("DELETE FROM sessions").run();
    db.exec("COMMIT");
    console.log(`Administrator password reset for ${email}. Artwork, articles, orders, and settings were preserved.`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}
