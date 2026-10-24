# Paid reveal and profile update

Apply this patch to the testing branch. It changes the foil flow to:

1. Choose artwork and sign in to identify the purchaser.
2. Open Stripe checkout without a reveal animation.
3. Wait for server-verified payment. A return URL alone does not confirm payment.
4. Show a concealed opening while the backend atomically allocates the tier and renders the private derivative.
5. Reveal the finished edition. The animation presents the server's result; replay never rerolls.
6. Click **Add to my collection** to display the edition in the account profile.

Ownership is recorded at purchase for security. Adding to the profile is a separate, idempotent action and does not transfer ownership or mint another edition. Paid editions not yet added are recoverable under **Purchases waiting to add**. Existing collections are preserved by the migration. Secondary sales retain their existing tier; ordinary digital and Gelato print orders are unchanged.

## Testing branch setup

First ensure migrations 202610190001, 202610190002 and 202610190003 are already applied. Apply `supabase/migrations/202610190004_post_reveal_collection.sql` to the testing database, then redeploy the updated `mint-access` Edge Function and storefront to the testing environment. Keep function authentication configuration consistent with the existing build: order-token reads remain supported; profile writes require an authenticated purchasing account.

Using a linked **testing** Supabase project:

```powershell
npx.cmd supabase db push
npx.cmd supabase functions deploy mint-access
npm.cmd run demo
```

`db push` applies all pending migrations; verify the linked project and pending list first. This patch has not been deployed and does not enable the mint engine by itself.

The local demo uses simulated payment and a brief queued rendering state, then permits explicit profile saving. No real payment or production account is used. Restart an already running demo server after replacing files.

Validation: syntax checks, unit/integration tests, desktop/mobile foil and marketplace tests, and the local demo exercise payment gating, concealed artwork, explicit profile saving, ownership isolation, retries, and replay behavior.
