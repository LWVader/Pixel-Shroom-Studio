import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./public/config.js";
export async function readPrintProducts(env = {}) {
  const response = await (env.PRINT_CATALOG_FETCH || fetch)(
    `${SUPABASE_URL}/rest/v1/gelato_storefront_products?select=id,title,kind,variant_label,preview_url,retail_cents&limit=100`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw Error("Printed products unavailable");
  const products = await response.json();
  if (!Array.isArray(products)) throw Error("Invalid product catalog");
  return { products };
}
