# Run Pixel Shroom minting on Modal (Windows setup)

This adapter replaces the always-on hosting requirement. Cloudflare, Supabase, existing Stripe purchases and Gelato physical checkout stay in place. Apply this patch over the previous foil-engine update. No additional database migration is included: the foil-engine migration must already be applied.

## 1. Prepare the project and Python

Open PowerShell in your Pixel-Shroom-Studio project folder, the one containing `package.json` and the new `modal_mint.py`. These commands run on your Windows PC, not in the website Admin or Supabase SQL Editor:

```powershell
npm.cmd ci
py -3.12 -m venv .venv-modal
.\.venv-modal\Scripts\python.exe -m pip install -r deploy/modal-requirements.txt
.\.venv-modal\Scripts\modal.exe setup
```

The last command opens Modal sign-in. Select the Modal workspace where you want this app and its Secrets. No PowerShell environment activation is needed. If `py -3.12` is missing, install Python 3.12 first.

## 2. Use your dedicated mint key

If you already generated `mint-private.pem`, reuse it. Do not generate a different key during each deployment. If you have not created the dedicated mint key yet:

```powershell
npm.cmd run mint:keys -- "C:\Private\PixelShroomMintKeys"
```

This key is separate from the original/master signing key. Back up the private PEM securely outside Git and public website files.

## 3. Create the Modal Secrets safely

```powershell
.\.venv-modal\Scripts\python.exe tools/configure-modal.py --key "C:\Private\PixelShroomMintKeys\mint-private.pem"
```

The helper asks for your Supabase project URL, private service-role key and Stripe secret key. Use the **same Supabase project and Stripe test/live environment** as your deployed checkout functions. Password-style inputs do not echo the keys. It creates:

- `pixel-shroom-mint-worker`: Supabase credentials, Stripe key and the mint private key encoded as Base64 (encoding is not encryption; Modal stores it as a Secret).
- `pixel-shroom-mint-control`: Supabase credentials and a random wake token. The signing key is not injected into the HTTP endpoint or scheduler.
- A local **private** `C:\Private\PixelShroomMintKeys\modal-supabase.env` file containing the matching wake token for Supabase.

If Secrets already exist and you intentionally want to update their values, rerun the same helper with `--update`. It reuses the local wake-token file. Do not paste service-role keys or the PEM into `public/config.js`, Git, or a chat.

## 4. Deploy to Modal

First confirm that `supabase/migrations/202610190001_foil_mint_engine.sql` from the previous update has been applied. Keep `FOIL_CHECKOUT_ENABLED` false while preparing the environment.

```powershell
.\.venv-modal\Scripts\modal.exe deploy modal_mint.py
```

This builds the Node 24/Sharp image and deploys the app **pixel-shroom-mint** with:

- `process_queue`: 2 CPU, 4096 MiB, at most one rendering container, no minimum running containers. It processes up to 10 jobs or a bounded time budget, then exits. A job still running at the outer timeout retains its allocation and is recovered through the database lease.
- `wake_endpoint`: an authenticated HTTP endpoint that starts a batch after verified payment. No browser or customer holds its token.
- `recover_queue`: a lightweight scheduled check once per minute, waking the image processor only when eligible queued/stale jobs exist. Every five minutes it also checks for pending foil orders requiring payment reconciliation.

Copy the deployment URL for **wake_endpoint**. It looks like `https://YOUR-WORKSPACE--pixel-shroom-mint-wake-endpoint.modal.run`. The adapter accepts POST requests at that base URL and at `/wake`. This is a runtime endpoint, not your Modal dashboard URL.

## 5. Connect your existing Supabase webhook

From the same project folder, using your existing logged-in/linked Supabase CLI setup:

```powershell
npx.cmd supabase secrets set --env-file "C:\Private\PixelShroomMintKeys\modal-supabase.env"
npx.cmd supabase secrets set MODAL_MINT_WAKE_URL="https://YOUR-MODAL-DEPLOYMENT-URL.modal.run/wake"
npx.cmd supabase functions deploy stripe-webhook
```

Replace the example URL with the actual endpoint. Do not copy the example literally. The webhook reads `MODAL_MINT_WAKE_URL` and `MODAL_MINT_WAKE_TOKEN` only on the server. After successful paid foil fulfillment it sends a short authenticated wake request. A timeout does not invalidate the confirmed payment: scheduled recovery still finds the queued job.

Keep the existing Stripe event subscriptions, including `checkout.session.expired`, and all the Supabase functions from the previous foil-engine update. This adapter does not replace them.

## 6. Smoke-test the remote worker

```powershell
.\.venv-modal\Scripts\modal.exe run modal_mint.py::process_queue
```

This runs in Modal, not on your laptop. With no queued jobs, a successful run registers the public signing key and prints `Mint batch finished` with zero processed jobs. With a queued paid job, it should print `Mint ready` and commit the private derivative. Use Modal's Apps → pixel-shroom-mint logs to inspect failures.

Next, on a staging project using Stripe **test** keys, enable the checkout gate, make one test purchase and confirm that the correct variant, image dimensions and signed receipt appear in the collection. Test verification using the downloaded WebP and receipt. Ordinary digital purchases and Gelato physical checkout must still work.

Only after staging passes, configure matching live credentials, deploy to the intended production workspace and enable live mint checkout:

```powershell
npx.cmd supabase secrets set FOIL_CHECKOUT_ENABLED=true
```

Do not create an additional always-on Render/Fly worker for the same setup. The existing database leases prevent duplicate allocation, but running unnecessary processors wastes resources.

## How this runs and what may cost money

A successful payment normally starts a batch promptly, including any cold-start time. Lost wake requests are picked up by the once-per-minute recovery schedule; rare missing payment/expiry events are reconciled on the five-minute check. Jobs, supply and tier allocations remain in Supabase when Modal scales down.

The 4 GB renderer is not kept running continuously. The lightweight scheduler still runs every minute, and image rendering, startup, networking, database operations and platform usage can consume credits or incur charges. No particular number of free mints is promised. Monitor Modal usage and representative image sizes before increasing traffic. The baseline memory can be raised in `modal_mint.py` if representative high-resolution files need it.

The original always-on `npm.cmd run mint:worker` command is still available for other hosts. Modal invokes the new `--batch` mode instead. No persistent Modal disk is needed: private masters, finished variants and the ledger remain in Supabase, and the signing key comes from Modal Secrets.

## Troubleshooting

- **Secret not found:** Run the configuration helper in the same Modal workspace/environment used by deployment. Confirm both exact Secret names.
- **Python version not found:** Install Python 3.12 or explicitly select another version supported by the pinned Modal SDK; the guide uses 3.12.
- **package.json not found:** Run deployment from the actual project root after applying both the foil-engine and Modal patches. The build copies an explicit file allowlist, not your entire project.
- **Private API request failed (404):** Confirm the foil migration exists in the configured Supabase project.
- **Private API request failed (401/403):** Check that the worker has the service-role key for that project, not the public anonymous key.
- **Wake returns 401:** Rerun the Supabase `--env-file` command using the file generated for those Modal Secrets. Existing deployments might need a redeploy after secret changes.
- **Wake fails but mints eventually render:** Check the actual endpoint URL and updated webhook deployment; recovery can still process the job.
- **Master identity mismatch:** Do not generate a new rarity. Check the stored master snapshot and signature; retries retain the original allocation.
- **Five failed attempts:** Investigate worker logs and retry the same failed mint using the admin `retry_foil_job` RPC after fixing the cause.

Official references: https://modal.com/docs/guide/images , https://modal.com/docs/guide/secrets , https://modal.com/docs/guide/cron .

## Local adapter tests (optional)

```powershell
.\.venv-modal\Scripts\python.exe -m pip install -r tests/modal-requirements.txt
.\.venv-modal\Scripts\python.exe tests/test_modal_adapter.py
npm.cmd run test:coverage
```

These tests use local fixtures and do not deploy an app, upload credentials or contact payment services. An actual Modal image build and Supabase-connected smoke test still happen during your deployment.
