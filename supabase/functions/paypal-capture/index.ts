// Retired payment endpoint. No provider requests or database writes are performed.
import { corsFor, json } from "../_shared/common.ts";

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsFor(request) });
  }
  return json({ error: "This payment endpoint is unavailable." }, 410, request);
});
