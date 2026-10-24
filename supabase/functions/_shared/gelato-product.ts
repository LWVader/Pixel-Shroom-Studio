// A catalog GET only: loading a product never creates an order or uploads artwork.
export async function loadGelatoProduct(uid: string, key: string, fetcher: typeof fetch = fetch) {
  if (!/^[-a-zA-Z0-9_]{5,500}$/.test(uid))
    throw Error("Enter the exact Gelato canvas product UID.");
  if (!key) throw Error("The Gelato API key is not configured.");
  const response = await fetcher(
    `https://product.gelatoapis.com/v3/products/${encodeURIComponent(uid)}`,
    {
      method: "GET",
      headers: { "X-API-KEY": key, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw Error(
      `Gelato could not load this product (${response.status}). Check its UID and API access.`,
    );
  const product = await response.json();
  if (
    product.productUid !== uid ||
    product.isPrintable !== true ||
    !Array.isArray(product.supportedCountries) ||
    !product.supportedCountries.includes("US") ||
    product.notSupportedCountries?.includes("US")
  )
    throw Error("Choose a printable Gelato product available in the United States.");
  if (!/canvas/i.test(uid + " " + JSON.stringify(product.attributes)))
    throw Error("Choose a Gelato canvas product for canvas rolls.");
  return {
    productUid: product.productUid,
    attributes: product.attributes || {},
    supportedCountries: product.supportedCountries,
    loadedAt: new Date().toISOString(),
  };
}

export function validateCatalogSelection(product: any, profile: any) {
  if (!profile) return;
  const entries = Object.entries(product.attributes || {}).map(([key, value]) => [
    key.toLowerCase(),
    String(value).toLowerCase(),
  ]);
  const color = entries
    .filter(([key]) => /frame.*(color|colour|finish)/.test(key))
    .map(([, value]) => value)
    .join(" ");
  const knownColor = /black/.test(color)
    ? "black"
    : /dark|walnut/.test(color)
      ? "dark-wood"
      : /natural/.test(color)
        ? "natural"
        : /none|unframed/.test(color)
          ? "none"
          : null;
  if (knownColor && knownColor !== profile.frame)
    throw Error(
      "The Gelato product’s frame finish does not match your selection. Choose its matching UID.",
    );
  const thickness = entries
    .filter(([key]) => /thick|depth/.test(key))
    .map(([, value]) => value)
    .join(" ");
  if (!profile.framed && /slim|thin|20.?mm|2.?cm/.test(thickness))
    throw Error(
      "Standard, Silver and Gold require thick canvas. Choose the thick-canvas product UID.",
    );
  const formats = entries
    .filter(([key]) => /format|size/.test(key))
    .map(([, value]) => value)
    .join(" ");
  const pair = formats.match(
    /(?:^|\D)(16|20|24|40|50|60|400|406|500|508|600|610)\s*[x×_-]\s*(16|20|24|40|50|60|400|406|500|508|600|610)(?!\d)/,
  );
  if (pair) {
    const aliases = (n: number) =>
      n === 24 ? [24, 60, 600, 610] : n === 20 ? [20, 50, 500, 508] : [16, 40, 400, 406];
    if (
      !aliases(profile.width).includes(Number(pair[1])) ||
      !aliases(profile.height).includes(Number(pair[2]))
    )
      throw Error(
        "The Gelato product’s catalog size does not match this tier’s canvas dimensions and portrait orientation. Choose the matching product UID.",
      );
  }
}
