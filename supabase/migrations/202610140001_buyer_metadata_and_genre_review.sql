-- Add public file specifications without exposing original storage paths.
begin;
alter table public.artworks add column if not exists original_width integer;
alter table public.artworks add column if not exists original_height integer;
alter table public.artworks add column if not exists original_format text;
alter table public.artworks add column if not exists original_dimensions_source text;
alter table public.artworks drop constraint if exists artworks_original_dimensions_check;
alter table public.artworks add constraint artworks_original_dimensions_check check ((original_width is null or original_width between 1 and 100000) and (original_height is null or original_height between 1 and 100000));
alter table public.artworks drop constraint if exists artworks_original_format_check;
alter table public.artworks add constraint artworks_original_format_check check (original_format is null or original_format in ('image/png','image/jpeg','image/webp','application/zip'));
alter table public.artworks drop constraint if exists artworks_original_dimensions_source_check;
alter table public.artworks add constraint artworks_original_dimensions_source_check check (original_dimensions_source is null or original_dimensions_source in ('registered','decoded'));

-- The existing admin registered source-image dimensions in display_width/height.
-- Preserve these as REGISTERED values; only future decoded uploads get source='decoded'.
-- Match both artwork ID and serial, and use the signature's original MIME type.
update public.artworks a set
  original_width = coalesce(a.original_width,a.display_width),
  original_height = coalesce(a.original_height,a.display_height),
  original_format = coalesce(a.original_format,s.mime_type),
  original_dimensions_source = coalesce(a.original_dimensions_source,'registered')
from public.artwork_signatures s
where s.artwork_id=a.id and s.serial_number=a.serial_number
  and s.mime_type in ('image/png','image/jpeg','image/webp','application/zip');

-- Only adjust the reviewed old assignments. Preserve subsequent manual changes.
update public.artworks set category='Dark Fantasy' where serial_number='LWV-1076123371' and category='Portrait';
update public.artworks set category='Horror' where serial_number='LWV-1317546991' and category='Portrait';
update public.artworks set category='Fantasy' where serial_number='LWV-8400430249' and category='Portrait';
update public.artworks set category='Fantasy' where serial_number='LWV-5714104482' and category='Portrait';
update public.artworks set category='Dark Fantasy' where serial_number='LWV-6821652269' and category='Portrait';
update public.artworks set category='Dark Fantasy' where serial_number='LWV-7332630323' and category='Fantasy';
comment on column public.artworks.original_dimensions_source is 'registered=existing source dimensions recorded in catalog; decoded=dimensions read from original upload by current admin.';
notify pgrst, 'reload schema';
commit;
