import {SUPABASE_ANON_KEY, SUPABASE_URL} from "../public/config.js";

function publicKey(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const claims = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(claims)).role === "anon";
  } catch {
    return false;
  }
}

export function adminProject(env) {
  const project = new URL(env.CAMPAIGN_SUPABASE_URL || SUPABASE_URL);
  if (project.protocol !== "https:" || project.username || project.password ||
      project.pathname !== "/" || project.search || project.hash) {
    throw new Error("Provide an HTTPS Supabase project origin.");
  }
  const key = env.CAMPAIGN_SUPABASE_PUBLIC_KEY || (project.origin === SUPABASE_URL ? SUPABASE_ANON_KEY : "");
  if (!publicKey(key)) throw new Error("Provide the project's Supabase publishable or anon key.");
  return {origin: project.origin, key};
}

export async function authenticatedAdmin(request, project, fetcher = fetch) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const headers = {Authorization: authorization, apikey: project.key};
  const userResponse = await fetcher(project.origin + "/auth/v1/user", {
    headers, signal: AbortSignal.timeout(12000), redirect: "error"
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json();
  if (!user.id) return null;
  const role = await fetcher(project.origin + "/rest/v1/rpc/is_admin", {
    method: "POST",
    headers: {...headers, "Content-Type": "application/json"},
    body: "{}",
    signal: AbortSignal.timeout(12000),
    redirect: "error"
  });
  return role.ok && await role.json() === true ? user : null;
}
