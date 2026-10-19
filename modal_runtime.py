"""Runtime helpers shared by Modal definitions and local tests; no credentials at import."""
import os
import subprocess
from datetime import datetime, timezone


def run_batch():
    env = os.environ.copy()
    env["MINT_BATCH_LIMIT"] = "10"
    env["MINT_BATCH_TIME_MS"] = "420000"
    subprocess.run(
        ["node", "/opt/pixel/mint-worker/worker.mjs", "--batch"],
        cwd="/opt/pixel", env=env, check=True, timeout=580,
    )
    return {"batch": "finished"}


def rest_has_rows(table, filters):
    import json
    import urllib.parse
    import urllib.request

    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    query = urllib.parse.urlencode({"select": "id", "limit": "1", **filters})
    request = urllib.request.Request(
        f"{base}/rest/v1/{table}?{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return bool(json.load(response))


def needs_work():
    now = datetime.now(timezone.utc)
    instant = now.isoformat()
    if rest_has_rows("mints", {
        "or": f"(and(state.eq.queued,available_at.lte.{instant}),and(state.eq.processing,lease_until.lt.{instant}))"
    }):
        return True
    return now.minute % 5 == 0 and rest_has_rows(
        "orders", {"sale_kind": "eq.foil", "status": "eq.pending"}
    )


def build_wake_app(spawn):
    import hmac
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @api.post("/")
    @api.post("/wake")
    async def wake(request: Request):
        expected = os.environ.get("MINT_WAKE_TOKEN", "")
        supplied = request.headers.get("authorization", "")
        if len(expected) < 32 or not hmac.compare_digest(supplied, f"Bearer {expected}"):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        call = await spawn()
        return JSONResponse({"queued": True, "callId": call.object_id}, status_code=202)

    return api
