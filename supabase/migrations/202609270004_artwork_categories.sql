-- SECTION: Pixel Shroom Studio supported artwork genres
-- Apply this once in the Supabase SQL Editor before using the new categories.

alter table public.artworks
  drop constraint if exists artworks_category_check;

alter table public.artworks
  add constraint artworks_category_check
  check (
    category in (
      'Portrait',
      'Fantasy',
      'Landscape',
      'Sci-Fi',
      'Abstract',
      'Dreamscape',
      'Dark Fantasy',
      'Horror',
      'NFT'
    )
  );

comment on column public.artworks.category is
  'Storefront genre: Portrait, Fantasy, Landscape, Sci-Fi, Abstract, Dreamscape, Dark Fantasy, Horror, or NFT.';
