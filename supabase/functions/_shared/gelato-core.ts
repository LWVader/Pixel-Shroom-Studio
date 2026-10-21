// Pure request validation/builders. No secrets, network calls or customer downloads.
export function recipientFor(input: any, email: string) {
  const limits: Record<string, number> = {
    firstName: 25,
    lastName: 25,
    addressLine1: 35,
    addressLine2: 35,
    city: 30,
    state: 35,
    postCode: 15,
    phone: 25,
  };
  const result: any = { country: "US", email };
  if (input?.country !== "US" || !/^\S+@\S+\.\S+$/.test(email))
    throw new Error("A valid US delivery address and account email are required.");
  for (const [key, max] of Object.entries(limits)) {
    const value = String(input?.[key] || "").trim();
    if (value.length > max || (!value && !["addressLine2", "phone"].includes(key)))
      throw new Error(`Check ${key} in your delivery address.`);
    if (value) result[key] = value;
  }
  result.state = result.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(result.state) || !/^\d{5}(-\d{4})?$/.test(result.postCode))
    throw new Error("Use a two-letter US state code and a valid ZIP code.");
  return result;
}
export function quotePayload(
  id: string,
  owner: string,
  product: any,
  quantity: number,
  recipient: any,
  url: string,
) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
    throw new Error("Choose a quantity from 1 to 10.");
  return {
    orderReferenceId: id,
    customerReferenceId: owner,
    currency: "USD",
    allowMultipleQuotes: false,
    recipient,
    products: [
      {
        itemReferenceId: id,
        productUid: product.product_uid,
        quantity,
        files: [{ type: "default", url }],
      },
    ],
  };
}
export function shippingOptions(response: any, product: any, quantity: number) {
  if (!Array.isArray(response?.quotes) || response.quotes.length !== 1)
    throw new Error("This destination needs a custom quote. Contact the studio.");
  const quote = response.quotes[0];
  if (
    !Array.isArray(quote.products) ||
    quote.products.length !== 1 ||
    quote.products[0].productUid !== product.product_uid ||
    Number(quote.products[0].quantity) !== quantity ||
    quote.products[0].currency !== "USD"
  )
    throw new Error("Product quote could not be verified.");
  const production = Number(quote.products[0].price);
  if (
    !Number.isFinite(production) ||
    production < 0 ||
    Math.ceil(production * 100) > product.retail_cents * quantity
  )
    throw new Error("This product needs a studio price review before checkout.");
  const options = (quote.shipmentMethods || [])
    .filter(
      (s: any) =>
        s.currency === "USD" &&
        Number.isFinite(Number(s.price)) &&
        Number(s.price) >= 0 &&
        typeof s.shipmentMethodUid === "string",
    )
    .map((s: any) => ({
      uid: s.shipmentMethodUid,
      name: String(s.name || "Delivery").slice(0, 100),
      cents: Math.ceil(Number(s.price) * 100),
      minDays: Number(s.minDeliveryDays) || null,
      maxDays: Number(s.maxDeliveryDays) || null,
    }));
  if (!options.length) throw new Error("No shipping option is available for this address.");
  return options;
}
export function orderPayload(order: any, url: string, liveAllowed: boolean) {
  if (order.payment_state !== "paid" || order.fulfillment_state !== "submitting")
    throw new Error("Verified payment and a submission claim are required.");
  if (!order.test_mode && !liveAllowed) throw new Error("Live Gelato fulfillment is not enabled.");
  return {
    orderType: order.test_mode ? "draft" : "order",
    orderReferenceId: order.id,
    customerReferenceId: order.owner_id,
    currency: "USD",
    shipmentMethodUid: order.shipment_method_uid,
    shippingAddress: order.recipient,
    items: [
      {
        itemReferenceId: order.id,
        productUid: order.product_snapshot.product_uid,
        quantity: order.quantity,
        files: [{ type: "default", url }],
      },
    ],
  };
}
