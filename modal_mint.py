"""Deploy from the project root: modal deploy modal_mint.py."""
from pathlib import Path
import modal
from modal_runtime import run_batch, needs_work, market_needs_work, recover_market_payments, build_wake_app

ROOT = Path(__file__).resolve().parent
app = modal.App("pixel-shroom-mint")
worker_secret = modal.Secret.from_name("pixel-shroom-mint-worker")
control_secret = modal.Secret.from_name("pixel-shroom-mint-control")

# Explicit file allowlist: private keys, .env files and gallery originals are
# never uploaded into the image. Secrets are injected only at runtime.
worker_image = (
    modal.Image.from_registry("node:24-bookworm-slim", add_python="3.12")
    .apt_install("fonts-dejavu-core")
    .add_local_file(ROOT / "package.json", "/opt/pixel/package.json", copy=True)
    .add_local_file(ROOT / "package-lock.json", "/opt/pixel/package-lock.json", copy=True)
    .run_commands("cd /opt/pixel && npm ci --omit=dev")
    .add_local_file(ROOT / "mint-worker/worker.mjs", "/opt/pixel/mint-worker/worker.mjs", copy=True)
    .add_local_file(ROOT / "mint-worker/render.mjs", "/opt/pixel/mint-worker/render.mjs", copy=True)
    .add_local_file(ROOT / "public/mint-core.js", "/opt/pixel/public/mint-core.js", copy=True)
    .add_local_python_source("modal_runtime")
)
control_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi==0.115.12").add_local_python_source("modal_runtime")


@app.function(
    image=worker_image,
    secrets=[worker_secret],
    cpu=2,
    memory=4096,
    timeout=600,
    max_containers=1,
    min_containers=0,
    scaledown_window=2,
    retries=0,
)
def process_queue():
    return run_batch()


@app.function(
    image=control_image,
    secrets=[control_secret],
    schedule=modal.Cron("* * * * *"),
    cpu=0.125,
    memory=128,
    timeout=45,
    max_containers=1,
    min_containers=0,
    scaledown_window=2,
    retries=0,
)
def recover_queue():
    recover_market_payments()
    if needs_work() or market_needs_work():
        call = process_queue.spawn()
        return {"queued": True, "callId": call.object_id}
    return {"queued": False}


@app.function(
    image=control_image,
    secrets=[control_secret],
    cpu=0.125,
    memory=128,
    timeout=30,
    max_containers=1,
    min_containers=0,
    scaledown_window=2,
)
@modal.asgi_app()
def wake_endpoint():
    return build_wake_app(process_queue.spawn.aio)
