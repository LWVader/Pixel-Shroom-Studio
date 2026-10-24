# Vault accounts and shipping profiles

My Vault now has an Account & Shipping tab alongside Artwork, Forge, Print, Orders and Resell. Customers use Supabase email/password accounts. Signup confirms the password and requests email confirmation according to project settings; existing customers can sign in with their existing passwords. Password-reset links return to the Vault recovery form. Ready paid editions and Forge eligibility remain tied to the existing authenticated user ID.

Shipping profiles store US recipient name, street, apartment, city, state, ZIP and optional phone. Account email supplies order notifications. Profiles are protected by owner-only row-level security and are never returned in the public catalog. No password or card details are stored in a shipping profile. Customers can update/remove the default address; this does not alter order snapshots or shipped orders. Print checkout fills saved details but never prechecks production consent or submits an order automatically. Manual delivery entry remains available if a profile has not been saved.

## Deployment

```powershell
npx.cmd supabase db push
npm.cmd run build
npx.cmd wrangler deploy
```

Apply the new `202610240003_vault_profiles.sql` migration before deploying the storefront. No new Edge Function is required.

## Supabase Auth settings

In Authentication → Sign In / Providers, ensure Email/password and new account signup are enabled. Keep email confirmation enabled for production. In URL Configuration set Site URL to `https://www.pixelshroomstudio.com` and allow these redirect URLs:

- `https://www.pixelshroomstudio.com/collection.html?tab=account`
- `https://www.pixelshroomstudio.com/collection.html?recovery=1`

Configure a production custom SMTP provider under Authentication email settings for confirmation and password-reset delivery. Having a `RESEND_API_KEY` Edge Function secret does not configure Supabase Auth SMTP automatically. Test signup confirmation, password-reset email delivery and returning to the Vault with a real test account. These hosted settings and mail delivery have not been changed or verified by the source update.

## Gelato admin

1. Select artwork and tier; optionally browse thumbnails or choose a computer file.
2. Choose one of seven canvas products and load its Gelato catalog details. The product controls size and frame; tier updates if needed.
3. Position and preview, save image position, then confirm Publish product.

UID, generated preview URL, readonly size/finish, shared artwork ID and editable prefilled tax classification sit in Advanced product details & tax. Prior paid orders retain their original mapping and order snapshots.
