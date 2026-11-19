const algorithm = {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cache = new Map();

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token encoding.");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (part) => part.charCodeAt(0));
}

async function signingKey(issuer, kid, fetcher) {
  let entry = cache.get(issuer);
  if (!entry || entry.expiresAt <= Date.now()) {
    const task = (async () => {
      const response = await fetcher(issuer + "/cdn-cgi/access/certs", {
        signal: AbortSignal.timeout(10000), redirect: "error"
      });
      if (!response.ok) throw new Error("Could not retrieve Access signing keys.");
      const body = await response.json();
      if (!Array.isArray(body.keys)) throw new Error("Invalid Access signing keys.");
      return body.keys;
    })();
    entry = {expiresAt: Date.now() + 60_000, task};
    cache.set(issuer, entry);
    task.catch(() => { if (cache.get(issuer) === entry) cache.delete(issuer); });
  }
  const jwk = (await entry.task).find((key) => key.kid === kid && key.kty === "RSA");
  return jwk ? crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]) : null;
}

export async function authenticatedAdmin(request, env, fetcher = fetch) {
  const issuer = String(env.ACCESS_TEAM_DOMAIN || "").trim().replace(/\/$/, "");
  const audience = String(env.ACCESS_AUDIENCE || "").trim();
  const administrator = String(env.ACCESS_ADMIN_EMAIL || "").trim().toLowerCase();
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  if (!audience || !administrator || token.length > 8192 ||
      !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) return null;

  try {
    const segments = token.split(".");
    if (segments.length !== 3) return null;
    const [header, payload, signature] = segments;
    const {alg, kid} = JSON.parse(decoder.decode(decode(header)));
    const claims = JSON.parse(decoder.decode(decode(payload)));
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (alg !== "RS256" || typeof kid !== "string" || !kid || claims.iss !== issuer ||
        !audiences.includes(audience) || !Number.isInteger(claims.exp) || claims.exp <= now ||
        (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now)) ||
        typeof claims.sub !== "string" || !claims.sub ||
        typeof claims.email !== "string" || claims.email.toLowerCase() !== administrator) return null;
    const key = await signingKey(issuer, kid, fetcher);
    if (!key || !await crypto.subtle.verify(algorithm.name, key, decode(signature),
      encoder.encode(header + "." + payload))) return null;
    return {id: claims.sub, email: administrator};
  } catch {
    return null;
  }
}
