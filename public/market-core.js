export function feeBreakdown(cents) {
  if (!Number.isInteger(cents) || cents < 100 || cents > 99999999)
    throw new Error("Enter a price from $1 to $999,999.99.");
  const fee = Math.round(cents * 0.1);
  return { price: cents, fee, seller: cents - fee };
}
export const marketMoney = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(cents) / 100,
  );
export function connectRedirectUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["connect.stripe.com", "express.stripe.com"].includes(url.hostname)
  )
    throw new Error("Invalid Stripe onboarding link.");
  return url.href;
}
export function marketPreviewUrl(path, base) {
  if (!/^secondary\/[a-f\d-]{36}\/[a-f\d-]{36}\.webp$/i.test(path))
    throw new Error("Invalid protected preview path.");
  return base.replace(/\/$/, "") + "/storage/v1/object/public/previews/" + path;
}
