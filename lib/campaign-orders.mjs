const catalog = Object.freeze({
  attention: {name: "Pixel Shroom Studio · Attention Pack", amount: 19900, mode: "payment"},
  landing: {name: "Pixel Shroom Studio · One-page Landing Page", amount: 19900, mode: "payment"},
  monthly: {name: "Pixel Shroom Studio · Monthly Asset Pack", amount: 4900, mode: "subscription"}
});
export const sessionPattern = /^cs_(test|live)_[A-Za-z0-9]{12,200}$/;
const requestPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const kind = "studio-campaign-v1";
const error = (message, status) => ({error: message, status});

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function briefFields(input) {
  const data = {
    business: clean(input?.business, 120),
    industry: clean(input?.industry, 100),
    vibe: clean(input?.vibe, 120),
    colors: clean(input?.colors, 150),
    goal: clean(input?.goal, 2400)
  };
  if (!data.business || !data.industry || !data.goal ||
      data.vibe.split(/[,\s]+/).filter(Boolean).length !== 3) {
    throw error("Enter a business name, industry, three words for the vibe, and your campaign goal.", 422);
  }
  return data;
}

export function createCampaignOrders({stripe, store, options, notify}) {
  const offers = () => ({
    attention: options.attention,
    landing: options.landing,
    monthly: Boolean(options.monthlyPrice && options.billingPortal),
    billingPortal: options.billingPortal
  });

  async function paid(sessionId) {
    if (typeof sessionId !== "string" || !sessionPattern.test(sessionId)) throw error("Use the checkout link Stripe returned you to.", 400);
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (cause) {
      if (cause.code === "resource_missing") throw error("This checkout could not be found.", 404);
      throw cause;
    }
    const offer = session.metadata?.campaign_offer;
    const item = Object.hasOwn(catalog, offer) && catalog[offer];
    if (session.metadata?.kind !== kind || !item || session.mode !== item.mode ||
        session.currency !== "usd" || session.amount_total !== item.amount) {
      throw error("This checkout could not be verified for a campaign order.", 404);
    }
    if (session.status !== "complete" || session.payment_status !== "paid") {
      throw error("Stripe has not confirmed payment yet. Refresh this page in a moment.", 409);
    }
    return {session, offer};
  }

  async function checkout(input) {
    const offer = input.offer;
    if (!Object.hasOwn(catalog, offer) || !offers()[offer]) throw error("This offer is unavailable online.", 503);
    if (!requestPattern.test(input.requestId ?? "")) throw error("Refresh the page and try again.", 400);
    const item = catalog[offer];
    let parent;
    let idempotencyKey = `campaign:${offer}:${input.requestId}`;
    if (offer === "landing") {
      const verified = await paid(input.parentSession);
      if (verified.offer !== "attention") throw error("The add-on is available with an Attention Pack.", 422);
      parent = verified.session;
      const existing = await store.get(parent.id);
      if (!existing) throw error("Submit your campaign brief before adding a landing page.", 409);
      if (existing.landing_session_id) {
        const landing = await stripe.checkout.sessions.retrieve(existing.landing_session_id);
        if (landing.status === "open" && landing.url) return {url: landing.url};
        if (landing.status === "complete") throw error("A landing page checkout has already been completed for your order.", 409);
        throw error("The previous landing page checkout expired. Email the studio to reopen it.", 409);
      }
      idempotencyKey = `campaign:landing:${parent.id}`;
    }
    let lineItem;
    if (offer === "monthly") {
      const price = await stripe.prices.retrieve(options.monthlyPrice);
      if (!price.active || price.currency !== "usd" || price.unit_amount !== item.amount ||
          price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 ||
          price.recurring.usage_type !== "licensed" || price.billing_scheme !== "per_unit") {
        throw error("Monthly checkout is temporarily unavailable.", 503);
      }
      lineItem = {price: price.id, quantity: 1};
    } else {
      lineItem = {
        quantity: 1,
        price_data: {currency: "usd", unit_amount: item.amount, product_data: {name: item.name}}
      };
    }
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: item.mode,
      payment_method_types: ["card"],
      line_items: [lineItem],
      success_url: `${options.site}/brief.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: parent
        ? `${options.site}/brief.html?session_id=${encodeURIComponent(parent.id)}`
        : `${options.site}/#${offer === "monthly" ? "monthly" : "pack"}`,
      metadata: {kind, campaign_offer: offer, ...(parent ? {parent_session: parent.id} : {})},
      ...(parent?.customer ? {customer: parent.customer} :
        parent?.customer_details?.email ? {customer_email: parent.customer_details.email} : {}),
      ...(offer === "monthly" ? {subscription_data: {metadata: {kind, campaign_offer: offer}}} : {})
    }, {idempotencyKey});
    if (parent) await store.setLanding(parent.id, checkoutSession.id);
    if (!checkoutSession.url) throw error("Stripe Checkout is temporarily unavailable.", 503);
    return {url: checkoutSession.url};
  }

  async function orderState({session, offer}) {
    if (offer === "landing") {
      const parentId = session.metadata.parent_session;
      await store.markLandingPaid(parentId, session.id);
      return {offer, submitted: true, canAddLanding: false};
    }
    const existing = await store.get(session.id);
    return {
      offer,
      submitted: Boolean(existing),
      canAddLanding: Boolean(existing && options.landing && offer === "attention" && !existing.landing_paid_at)
    };
  }

  async function submit(input) {
    const {session, offer} = await paid(input.sessionId);
    if (offer === "landing") throw error("Use the original Attention Pack link to submit your brief.", 422);
    const buyerEmail = session.customer_details?.email;
    if (!buyerEmail) throw error("Email the studio with your Stripe receipt so we can match your order.", 409);
    const record = {
      checkout_session_id: session.id,
      offer,
      buyer_email: buyerEmail,
      ...briefFields(input.brief)
    };
    const inserted = await store.save(record);
    if (inserted) {
      try {
        await notify(record);
      } catch {
        // The brief is durable even when the notification provider is unavailable.
        console.error("Campaign brief notification failed.");
      }
    }
    return orderState({session, offer});
  }

  return async (input) => {
    switch (input?.action) {
      case "offers": return offers();
      case "checkout": return checkout(input);
      case "order": return orderState(await paid(input.sessionId));
      case "brief": return submit(input);
      case "download": throw error("Campaign ZIPs are now sent by email.", 410);
      default: throw error("Unknown campaign action.", 400);
    }
  };
}
