# Reset the test storefront

This clears test data on the existing Pixel Shroom Studio project. It keeps the storefront design, database schema, account logins, administrator access, registered signing keys, project settings, Stripe and Gelato credentials, and the historical migration files. It releases old artwork serials and does not recycle numeric artwork IDs. The reset does not cancel, refund, or erase anything in Stripe or Gelato.

1. Start with the clean source ZIP in a fresh folder or apply the update ZIP plus its removal list. Carry over local environment files, signing identity, and any custom Cloudflare configuration. Keep those out of version control. The supplied public configuration targets the existing project, `decizwtgsqhjdgjiqbui`.
2. From the project folder, link Supabase and review the pending migrations:

   ```powershell
   npm.cmd ci
   npx.cmd supabase link --project-ref decizwtgsqhjdgjiqbui
   npx.cmd supabase migration list
   npx.cmd supabase db push --dry-run
   npx.cmd supabase db push
   ```

   Version `202611130001` installs the old `public.preview_artwork_rebuild()` RPC and Standard tier upload helper. Version `202611130002` installs the new full reset and reloads the API schema cache. Applying them does not erase anything. If the old RPC still reports a schema cache error, check the project in `public/config.js` and run this in that project's SQL Editor:

   ```sql
   select to_regprocedure('public.preview_artwork_rebuild()') as old_preview,
          to_regprocedure('public.preview_storefront_reset()') as full_reset;
   notify pgrst, 'reload schema';
   ```

   A null value means the function is absent in that project; refreshing the cache cannot install it. Do not use `supabase db reset --linked`.

3. Deploy the storefront through the existing Cloudflare workflow, or run `npx.cmd wrangler deploy` using your existing Worker account and routing configuration. The Worker builds and deploys `dist/public`.
4. Pause test checkouts, mint workers or Modal wake jobs, marketplace reconciliation, and admin uploads for the reset window. Wait for in-progress jobs to stop. Keep test checkout off until new products are ready. In **Admin → Images → Reset test storefront**, click **Preview test reset**, review the counts, click **Permanently clear test data**, and type `RESET TEST STOREFRONT`. If counts changed, run the preview again once the store is idle. Preview again after success to verify the app records are empty.
5. In **Supabase Dashboard → Storage**, empty the contents of the four studio buckets listed below. Confirm they contain only the studio's old test files; leave each bucket, its permissions, and settings intact. Use Storage rather than a SQL DELETE; direct SQL deletion of object metadata does not remove the actual file. Do this **before** any new uploads.

   | Bucket               | Files                           |
   | -------------------- | ------------------------------- |
   | `previews`           | Protected public previews       |
   | `originals`          | Masters and private tier files  |
   | `minted`             | Prepared copies and derivatives |
   | `gelato-print-files` | Private print compositions      |

6. Confirm the public gallery is empty; cached results can take up to a minute to disappear. Upload one artwork with its six tiers (Standard is the source upload), confirm the serial is accepted and the protected previews are visible, then resume mint processing and prepare the copy inventory. Recreate required Gelato mappings before reopening canvas checkout. Run `npm.cmd run test:journey:preflight -- --artwork NEW_ARTWORK_ID` on staging before testing payments.

## Remove retired remote endpoints

Deleting source files does not remove already deployed Edge Functions. If `functions list` still shows the retired endpoints below, remove any webhook registrations for them in the corresponding provider dashboard, then delete only those endpoints:

```powershell
npx.cmd supabase functions list --project-ref decizwtgsqhjdgjiqbui
npx.cmd supabase functions delete paypal-capture --project-ref decizwtgsqhjdgjiqbui
npx.cmd supabase functions delete paypal-webhook --project-ref decizwtgsqhjdgjiqbui
npx.cmd supabase functions delete physical-checkout --project-ref decizwtgsqhjdgjiqbui
```

Keep the active `download-original` function; only its duplicate nested source copy was removed. No new Edge Function deployment is required just to install the database reset.
