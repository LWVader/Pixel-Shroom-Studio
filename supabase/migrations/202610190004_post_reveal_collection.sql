-- Preserve existing collections; newly reserved editions require an explicit add.
ALTER TABLE public.mints ADD COLUMN collection_added_at timestamptz;
UPDATE public.mints SET collection_added_at = created_at;
CREATE INDEX mints_owner_collection ON public.mints(owner_id, collection_added_at);

CREATE OR REPLACE FUNCTION public.add_mint_to_collection(target_mint uuid, holder uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE edition public.mints%ROWTYPE;
BEGIN
  SELECT * INTO edition FROM public.mints WHERE id = target_mint FOR UPDATE;
  IF NOT FOUND OR edition.owner_id IS DISTINCT FROM holder
     OR edition.state <> 'ready' OR edition.market_frozen
     OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = edition.order_id AND status = 'paid') THEN
    RAISE EXCEPTION 'Paid, ready edition owned by this account required';
  END IF;
  UPDATE public.mints SET collection_added_at = COALESCE(collection_added_at, now())
    WHERE id = target_mint;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.add_mint_to_collection(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_mint_to_collection(uuid, uuid) TO service_role;
