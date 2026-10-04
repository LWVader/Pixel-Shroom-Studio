// SECTION: Public message intake and administrator email alert
import { createClient } from "npm:@supabase/supabase-js@2";

import { studioSiteUrl } from "../_shared/common.ts";
const siteUrl = studioSiteUrl();

// This is an intentionally public form endpoint. Authentication and database
// authorization still happen server-side; CORS is not used as a security
// boundary. Allowing every storefront origin also supports Cloudflare preview
// deployments and custom-domain changes without breaking the form.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, maximum: number): string {
  return String(value || "").trim().slice(0, maximum);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const body = await request.json();
    if (body.website) return json({ sent: true }); // Honeypot: quietly discard automated spam.

    const record = {
      name: text(body.name, 100),
      email: text(body.email, 254).toLowerCase(),
      subject: text(body.subject, 160),
      message: text(body.message, 5000),
    };
    if (!record.name || !record.subject || record.message.length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
      return json({ error: "Complete every message field with a valid email address." }, 400);
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: saved, error: insertError } = await service
      .from("contact_messages")
      .insert(record)
      .select("id")
      .single();
    if (insertError) throw insertError;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const alertEmail = Deno.env.get("ADMIN_ALERT_EMAIL") || "phantasmocazdor@gmail.com";
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");
    if (!resendKey || !fromEmail) {
      const configurationError = [
        !resendKey ? "RESEND_API_KEY is missing" : "",
        !fromEmail ? "RESEND_FROM_EMAIL is missing" : "",
      ].filter(Boolean).join("; ");
      console.error("Message saved, but email alert is not configured:", configurationError);
      await service.from("contact_messages").update({ alert_error: configurationError }).eq("id", saved.id);
      return json({ sent: true, alertSent: false });
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [alertEmail],
        reply_to: record.email,
        subject: `Pixel Shroom message: ${record.subject}`,
        html: `<h2>New Pixel Shroom Studio message</h2><p><b>From:</b> ${escapeHtml(record.name)} &lt;${escapeHtml(record.email)}&gt;</p><p><b>Subject:</b> ${escapeHtml(record.subject)}</p><p>${escapeHtml(record.message).replaceAll("\n", "<br>")}</p><p><a href="${siteUrl}/admin.html#messages-view">Open the admin inbox</a></p>`,
      }),
    });
    if (!emailResponse.ok) {
      const failure = (await emailResponse.text()).slice(0, 500);
      console.error("Resend rejected the message alert:", emailResponse.status, failure);
      await service.from("contact_messages").update({ alert_error: failure }).eq("id", saved.id);
      return json({ sent: true, alertSent: false });
    }

    await service.from("contact_messages").update({ alert_sent_at: new Date().toISOString(), alert_error: null }).eq("id", saved.id);
    return json({ sent: true, alertSent: true });
  } catch (error) {
    console.error("Message submission failed:", error);
    return json({ error: "Your message could not be sent." }, 500);
  }
});
