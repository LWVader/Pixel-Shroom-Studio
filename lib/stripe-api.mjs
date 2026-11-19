function stripeForm(input) {
  const form = new URLSearchParams();
  function append(key, value) {
    if (value && typeof value === "object") {
      for (const [name, entry] of Object.entries(value)) append(`${key}[${name}]`, entry);
    } else if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }
  for (const [key, value] of Object.entries(input)) append(key, value);
  return form;
}

export function stripeApi(secret, fetcher = fetch) {
  async function request(path, body, idempotencyKey) {
    const headers = new Headers({
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": "2025-03-31.basil"
    });
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const response = await fetcher("https://api.stripe.com/v1/" + path, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? {body: stripeForm(body)} : {}),
      signal: AbortSignal.timeout(15000),
      redirect: "error"
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error("Stripe API request failed."), {code: data?.error?.code});
    return data;
  }

  return {
    checkout: {sessions: {
      create: (body, {idempotencyKey} = {}) => request("checkout/sessions", body, idempotencyKey),
      retrieve: (id) => request("checkout/sessions/" + encodeURIComponent(id))
    }},
    prices: {retrieve: (id) => request("prices/" + encodeURIComponent(id))}
  };
}
