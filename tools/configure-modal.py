"""Create named Modal Secrets interactively, without putting credentials in CLI args."""
import argparse
import base64
import getpass
import os
from pathlib import Path
import secrets
from urllib.parse import urlparse

import modal


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", required=True, help="Existing dedicated mint-private.pem path")
    parser.add_argument("--update", action="store_true", help="Explicitly replace existing named Modal Secrets")
    args = parser.parse_args()
    key_path = Path(args.key).expanduser().resolve()
    pem = key_path.read_bytes()
    if b"BEGIN PRIVATE KEY" not in pem:
        raise SystemExit("Select the dedicated mint-private.pem created by mint:keys.")
    url = input("Supabase project URL: ").strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path:
        raise SystemExit("Enter the HTTPS project URL without a path.")
    service_key = getpass.getpass("Supabase SERVICE ROLE key (hidden): ").strip()
    stripe_key = getpass.getpass("Stripe secret key for the same environment (hidden): ").strip()
    if not service_key or not stripe_key.startswith("sk_"):
        raise SystemExit("Service-role and Stripe secret keys are required.")
    wake_file = key_path.parent / "modal-supabase.env"
    if wake_file.exists():
        line = wake_file.read_text().strip()
        if not line.startswith("MODAL_MINT_WAKE_TOKEN=") or "\n" in line:
            raise SystemExit("Existing modal-supabase.env has unexpected contents; keep it and review manually.")
        wake_token = line.split("=", 1)[1]
        if len(wake_token) < 32:
            raise SystemExit("Existing wake token is invalid.")
    else:
        wake_token = secrets.token_hex(32)
        fd = os.open(str(wake_file), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(f"MODAL_MINT_WAKE_TOKEN={wake_token}\n")
    modal.Secret.objects.create(
        "pixel-shroom-mint-worker",
        {
            "SUPABASE_URL": url,
            "SUPABASE_SERVICE_ROLE_KEY": service_key,
            "STRIPE_SECRET_KEY": stripe_key,
            "MINT_SIGNING_KEY_B64": base64.b64encode(pem).decode("ascii"),
        },
        allow_existing=args.update,
    )
    print("Saved pixel-shroom-mint-worker.")
    modal.Secret.objects.create(
        "pixel-shroom-mint-control",
        {"SUPABASE_URL": url, "SUPABASE_SERVICE_ROLE_KEY": service_key, "MINT_WAKE_TOKEN": wake_token},
        allow_existing=args.update,
    )
    print("Saved pixel-shroom-mint-control.")
    print(f"Private Supabase wake-token file: {wake_file}")
    print("No credentials were printed. Deploy modal_mint.py next.")


if __name__ == "__main__":
    main()
