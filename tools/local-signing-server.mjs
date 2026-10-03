// SECTION: Local-only Pixel Shroom Studio C2PA signing service
import {
  createHash,
  createPrivateKey,
  randomBytes,
  timingSafeEqual,
  X509Certificate
} from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PIXEL_SIGNING_PORT || 4179);
const SCRIPT_DIRECTORY = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const SIGNING_DIRECTORY = resolve(
  process.env.PIXEL_SIGNING_DIRECTORY || join(PROJECT_ROOT, "signing")
);
const PRIVATE_KEY = resolve(
  process.env.PIXEL_SIGNING_PRIVATE_KEY || join(SIGNING_DIRECTORY, "signing-private.pem")
);
const SIGNING_CERTIFICATE = resolve(
  process.env.PIXEL_SIGNING_CERTIFICATE || join(SIGNING_DIRECTORY, "signing-cert.pem")
);
const TOKEN_FILE = resolve(
  process.env.PIXEL_SIGNING_TOKEN_FILE || join(SIGNING_DIRECTORY, ".signing-helper-token")
);
const C2PA_TOOL = process.env.C2PA_TOOL || "c2patool";
const MAX_FILE_BYTES = Number(process.env.PIXEL_SIGNING_MAX_BYTES || 250 * 1024 * 1024);
const ALLOWED_ORIGINS = new Set(
  (process.env.PIXEL_SIGNING_ALLOWED_ORIGINS || [
    "https://www.pixelshroomstudio.com",
    "https://pixelshroomstudio.com",
    "http://localhost:3000",
    "http://localhost:4173",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:8080"
  ].join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const SUPPORTED_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);

// SECTION: Security and response helpers
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": [
      "authorization",
      "content-type",
      "x-artwork-title",
      "x-artwork-serial",
      "x-artwork-creator",
      "x-artwork-filename"
    ].join(", "),
    "Access-Control-Expose-Headers": "X-SHA256, X-Signed-Filename",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function sendJson(response, origin, status, data) {
  response.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(data));
}

function allowedOrigin(request) {
  const origin = request.headers.origin || "";
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function decodeHeader(value, field) {
  if (!value) throw new Error(`${field} is required.`);
  const decoded = decodeURIComponent(String(value)).trim();
  if (!decoded || decoded.length > 200) throw new Error(`${field} is invalid.`);
  return decoded;
}

function safeName(value) {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 160);
}

function tokenMatches(received, expected) {
  const actual = Buffer.from(received || "", "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function requireFile(path, label) {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} was not found or is not readable: ${path}`);
  }
}

// SECTION: C2PA signing-identity preflight
const C2PA_SIGNING_EKUS = new Set([
  "1.3.6.1.5.5.7.3.4",  // id-kp-emailProtection
  "1.3.6.1.5.5.7.3.36"  // id-kp-documentSigning
]);

async function validateSigningIdentity() {
  await requireFile(PRIVATE_KEY, "Private signing key");
  await requireFile(SIGNING_CERTIFICATE, "Signing certificate");

  const [privateKeyPem, certificatePem] = await Promise.all([
    readFile(PRIVATE_KEY, "utf8"),
    readFile(SIGNING_CERTIFICATE, "utf8")
  ]);
  const certificate = new X509Certificate(certificatePem);
  const privateKey = createPrivateKey(privateKeyPem);
  const now = Date.now();

  if (certificate.issuer === certificate.subject) {
    throw new Error(
      "The signing certificate is self-signed and cannot be used by c2patool. " +
      "Run tools\\create-signing-identity.ps1 -ReplaceInvalidIdentity."
    );
  }
  if (certificate.ca) {
    throw new Error("The signing certificate is a CA certificate; a C2PA end-entity certificate is required.");
  }
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) {
    throw new Error("The signing certificate is not currently valid.");
  }
  if (!certificate.checkPrivateKey(privateKey)) {
    throw new Error("The signing certificate does not match signing-private.pem.");
  }

  const keyUsage = certificate.keyUsage || [];
  if (!keyUsage.some((usage) => C2PA_SIGNING_EKUS.has(usage))) {
    throw new Error(
      "The signing certificate lacks the C2PA emailProtection or documentSigning EKU. " +
      "Run tools\\create-signing-identity.ps1 -ReplaceInvalidIdentity."
    );
  }
  return certificate;
}

async function loadOrCreateToken() {
  await mkdir(SIGNING_DIRECTORY, { recursive: true });
  try {
    return (await readFile(TOKEN_FILE, "utf8")).trim();
  } catch {
    const token = randomBytes(32).toString("hex");
    await writeFile(TOKEN_FILE, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    return token;
  }
}

async function readRequestBody(request) {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > MAX_FILE_BYTES) throw new Error("The selected artwork exceeds the local signing size limit.");

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_FILE_BYTES) {
      request.destroy();
      throw new Error("The selected artwork exceeds the local signing size limit.");
    }
    chunks.push(chunk);
  }
  if (!total) throw new Error("The artwork file is empty.");
  return Buffer.concat(chunks);
}

// SECTION: c2patool execution
function runC2paTool(argumentsList) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(C2PA_TOOL, argumentsList, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => rejectPromise(
      new Error(`Could not start c2patool: ${error.message}`)
    ));
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(stderr.trim() || stdout.trim() || `c2patool exited with code ${code}.`));
    });
  });
}

function buildManifest({ title, serial, creator, mimeType }) {
  return {
    claim_generator: "Pixel Shroom Studio/1.0",
    title,
    format: mimeType,
    alg: "es256",
    private_key: PRIVATE_KEY,
    sign_cert: SIGNING_CERTIFICATE,
    assertions: [
      {
        label: "c2pa.actions.v2",
        data: {
          actions: [{
            action: "c2pa.created",
            softwareAgent: "Pixel Shroom Studio",
            digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
          }],
          allActionsIncluded: true
        }
      },
      {
        label: "com.pixelshroom.identity",
        data: {
          serial_number: serial,
          creator,
          studio: "Pixel Shroom Studio"
        }
      }
    ]
  };
}

async function signArtwork(request, response, origin, expectedToken) {
  const authorization = request.headers.authorization || "";
  const suppliedToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!tokenMatches(suppliedToken, expectedToken)) {
    return sendJson(response, origin, 401, { error: "The local signing-helper token is invalid." });
  }

  const mimeType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
  const expectedExtension = SUPPORTED_TYPES.get(mimeType);
  if (!expectedExtension) {
    return sendJson(response, origin, 415, { error: "Only PNG, JPEG, and WebP originals are supported." });
  }

  const title = decodeHeader(request.headers["x-artwork-title"], "Artwork title");
  const serial = decodeHeader(request.headers["x-artwork-serial"], "Artwork serial").toUpperCase();
  const creator = decodeHeader(request.headers["x-artwork-creator"], "Creator");
  const originalName = safeName(decodeHeader(request.headers["x-artwork-filename"], "File name"));
  if (!/^LWV-[A-Z0-9-]+$/.test(serial)) {
    return sendJson(response, origin, 400, { error: "The artwork serial must begin with LWV-." });
  }

  await validateSigningIdentity();
  const sourceBytes = await readRequestBody(request);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pixel-shroom-sign-"));
  const inputPath = join(temporaryDirectory, `source${expectedExtension}`);
  const outputName = `${safeName(title).replace(/\.[^.]+$/, "")}-${serial}${expectedExtension}`;
  const outputPath = join(temporaryDirectory, outputName);
  const manifestPath = join(temporaryDirectory, "manifest.json");

  try {
    await writeFile(inputPath, sourceBytes);
    await writeFile(
      manifestPath,
      JSON.stringify(buildManifest({ title, serial, creator, mimeType }), null, 2),
      "utf8"
    );
    await runC2paTool([inputPath, "--manifest", manifestPath, "--output", outputPath]);
    await runC2paTool([outputPath]);

    const signedBytes = await readFile(outputPath);
    const sha256 = createHash("sha256").update(signedBytes).digest("hex");
    response.writeHead(200, {
      ...corsHeaders(origin),
      "Content-Type": mimeType,
      "Content-Length": String(signedBytes.length),
      "X-SHA256": sha256,
      "X-Signed-Filename": encodeURIComponent(outputName)
    });
    response.end(signedBytes);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

// SECTION: Local HTTP server
await validateSigningIdentity();
const signingToken = await loadOrCreateToken();

const server = createServer(async (request, response) => {
  const origin = allowedOrigin(request);
  if (!origin) {
    response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "This website origin is not allowed to use the signing helper." }));
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/health") {
      await validateSigningIdentity();
      return sendJson(response, origin, 200, { ready: true });
    }
    if (request.method === "POST" && request.url === "/sign") {
      await signArtwork(request, response, origin, signingToken);
      return;
    }
    sendJson(response, origin, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, origin, 500, {
        error: error instanceof Error ? error.message : "Local signing failed."
      });
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Pixel Shroom signing helper: http://${HOST}:${PORT}`);
  console.log(`Allowed storefront origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
  console.log(`Admin session token: ${signingToken}`);
  console.log("Keep this window open while publishing artwork. Press Ctrl+C to stop.");
});
