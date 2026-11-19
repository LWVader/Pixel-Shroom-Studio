const encoder = new TextEncoder();
const algorithm = "HMAC";
const lifetime = 6 * 60 * 60;
const windowSeconds = 15 * 60;

export function passwordConfigured(env) {
  return typeof env.ADMIN_PASSWORD === "string" && env.ADMIN_PASSWORD.length >= 24 &&
    env.ADMIN_PASSWORD.length <= 512 && Boolean(env.CAMPAIGN_DB);
}

function passwordKey(password) {
  return crypto.subtle.importKey("raw", encoder.encode(password),
    {name: algorithm, hash: "SHA-256"}, false, ["sign", "verify"]);
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (part) => part.toString(16).padStart(2, "0")).join("");
}

function bytes(value) {
  return Uint8Array.from(value.match(/../g), (pair) => parseInt(pair, 16));
}

function cookieName(url) {
  return url.protocol === "https:" ? "__Host-pss_admin" : "pss_admin_dev";
}

function supportedOrigin(url) {
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function sessionCookie(url, value, maxAge) {
  return `${cookieName(url)}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${url.protocol === "https:" ? "; Secure" : ""}`;
}

export async function passwordAdmin(request, env, url) {
  if (!passwordConfigured(env) || !supportedOrigin(url)) return null;
  const prefix = cookieName(url) + "=";
  const token = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!token || !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return null;
  const [expires, nonce, signature] = token.split(".");
  const now = Math.floor(Date.now() / 1000);
  if (Number(expires) <= now || Number(expires) > now + lifetime) return null;
  const key = await passwordKey(env.ADMIN_PASSWORD);
  const value = encoder.encode(`session|${url.origin}|${expires}.${nonce}`);
  if (!await crypto.subtle.verify(algorithm, key, bytes(signature), value)) return null;
  return {id: "studio-owner", email: env.ACCESS_ADMIN_EMAIL || ""};
}

async function reserveAttempt(db, request, now) {
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const bucket = "ip:" + hex(await crypto.subtle.digest("SHA-256", encoder.encode(ip)));
  const increment = (name) => db.prepare(`
    INSERT INTO admin_login_attempts (bucket, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT (bucket) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING attempts
  `).bind(name, windowStart);

  const results = await db.batch([
    db.prepare("DELETE FROM admin_login_attempts WHERE window_start < ?").bind(windowStart - windowSeconds),
    increment(bucket), increment("global")
  ]);
  return results[1].results[0].attempts <= 10 && results[2].results[0].attempts <= 150;
}

export async function signInWithPassword(request, env, url, password) {
  if (!passwordConfigured(env) || !supportedOrigin(url)) {
    throw {error: "Set the Worker admin password and apply its database migration to enable sign-in.", status: 503};
  }
  if (typeof password !== "string" || !password || password.length > 512) {
    throw {error: "Enter the administrator password.", status: 400};
  }
  const now = Math.floor(Date.now() / 1000);
  if (!await reserveAttempt(env.CAMPAIGN_DB, request, now)) {
    throw {error: "Too many sign-in attempts. Try again in 15 minutes.", status: 429};
  }
  const key = await passwordKey(env.ADMIN_PASSWORD);
  const supplied = await crypto.subtle.sign(algorithm, key, encoder.encode("password|" + password));
  if (!await crypto.subtle.verify(algorithm, key, supplied, encoder.encode("password|" + env.ADMIN_PASSWORD))) {
    throw {error: "The administrator password is incorrect.", status: 401};
  }
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const token = `${now + lifetime}.${nonce}`;
  const signature = await crypto.subtle.sign(algorithm, key, encoder.encode(`session|${url.origin}|${token}`));
  return sessionCookie(url, `${token}.${hex(signature)}`, lifetime);
}

export function clearPasswordSession(url) {
  return sessionCookie(url, "", 0);
}
