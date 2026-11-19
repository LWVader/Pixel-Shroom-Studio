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

export class StripeRequestError extends Error {
  constructor(message, {status, code, requestId} = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = /^req_[a-zA-Z0-9]+$/.test(requestId || "") ? requestId : null;
  }
}

export function stripeApi(secret, fetcher = fetch) {
  async function request(path, body, idempotencyKey) {
    const headers = new Headers({
      Authorization: `Bearer ${secret}`,
      "Stripe-Version": "2025-03-31.basil"
    });
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const signal = AbortSignal.timeout(15000);
    let response;
    try {
      response = await fetcher("https://api.stripe.com/v1/" + path, {
        method: body ? "POST" : "GET",
        headers,
        ...(body ? {body: stripeForm(body)} : {}),
        signal,
        redirect: "error"
      });
    } catch {
      throw new StripeRequestError("Stripe API connection failed.", {
        code: signal.aborted ? "worker_timeout" : "worker_connection"
      });
    }
    const details = {status: response.status, requestId: response.headers.get("Request-Id")};
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new StripeRequestError("Stripe API request failed.", {...details, code: data?.error?.code});
    }
    if (data === null) throw new StripeRequestError("Stripe returned an unexpected response.", details);
    return data;
  }

  return {
    checkConnection: async () => {
      const result = await request("checkout/sessions?limit=1");
      if (result.object !== "list") {
        throw new StripeRequestError("Stripe returned an unexpected response.");
      }
    },
    checkout: {sessions: {
      create: (body, {idempotencyKey} = {}) => request("checkout/sessions", body, idempotencyKey),
      retrieve: (id) => request("checkout/sessions/" + encodeURIComponent(id))
    }},
    prices: {retrieve: (id) => request("prices/" + encodeURIComponent(id))}
  };
}
