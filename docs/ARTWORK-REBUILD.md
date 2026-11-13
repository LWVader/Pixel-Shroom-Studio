# Artwork rebuild and Standard upload

Extract the update over your existing project. In PowerShell:

```powershell
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
npm.cmd run build
npx.cmd wrangler deploy
```

The migration installs controls only. It does not delete any existing record on deployment. No Edge Function redeploy is required.

Restart the local signing helper from the updated project using your existing signing identity and token. If Sharp is missing, run `npm.cmd ci` first.

```powershell
.\tools\start-signing-helper.ps1
```

In Admin → Images → **Permanently reset old artwork records**:

1. Select **Preview permanent reset**. Expand both lists to review IDs and serials, including hidden records.
2. Select **Permanently delete unlinked artwork records** and type `DELETE ARTWORK` only after reviewing the list. The database rechecks eligibility before deleting.
3. Upload the redesigned Standard file, plus Silver, Gold, Emerald, Sapphire and Prismatic. Standard also serves as the private signed original. Its protected preview and signed file are reused for the Standard mapping.

The reset removes eligible artwork rows and their signatures, tier mappings, unassigned copy inventory and artwork-specific print mappings. Orders, reservations, Forge history and print quotes protect their linked artwork. Those records still reserve their serials. Uploaded files are retained in Storage; this update does not purge buckets. Public gallery updates can take up to 60 seconds.

There is no manual serial field. The updated local helper reads one LWV serial (10 or 11 digits) from supported PNG text, EXIF, XMP or IPTC metadata. If absent, it uses the filename, for example `Orc_LWV-3249949452_4800x4800.png`. Text drawn into the image is not metadata. An edit without a new Standard file keeps the saved serial. The form checks for an existing serial before signing or uploading a new file.
