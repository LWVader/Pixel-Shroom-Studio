export function campaignStore(db) {
  const get = (id) => db.prepare(
    "SELECT landing_session_id, landing_paid_at FROM campaign_briefs WHERE checkout_session_id = ?"
  ).bind(id).first();

  return {
    get,
    async save(brief) {
      const result = await db.prepare(`
        INSERT INTO campaign_briefs
          (checkout_session_id, offer, buyer_email, business, industry, vibe, colors, goal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (checkout_session_id) DO NOTHING
      `).bind(brief.checkout_session_id, brief.offer, brief.buyer_email, brief.business,
        brief.industry, brief.vibe, brief.colors, brief.goal).run();
      return result.meta.changes === 1;
    },
    async setLanding(parent, landing) {
      const result = await db.prepare(`
        UPDATE campaign_briefs SET landing_session_id = ?
        WHERE checkout_session_id = ? AND landing_session_id IS NULL
      `).bind(landing, parent).run();
      if (!result.meta.changes && (await get(parent))?.landing_session_id !== landing) {
        throw new Error("Landing checkout association changed.");
      }
    },
    async markLandingPaid(parent, landing) {
      if (typeof parent !== "string") return;
      await db.prepare(`
        UPDATE campaign_briefs SET landing_paid_at = ?
        WHERE checkout_session_id = ? AND landing_session_id = ? AND landing_paid_at IS NULL
      `).bind(new Date().toISOString(), parent, landing).run();
    },
    async list(offset) {
      const {results} = await db.prepare(`
        SELECT checkout_session_id, offer, buyer_email, business, industry, vibe, colors,
               goal, created_at, landing_paid_at, email_delivered_at
        FROM campaign_briefs
        ORDER BY created_at DESC, checkout_session_id
        LIMIT 26 OFFSET ?
      `).bind(offset).all();
      return {orders: results.slice(0, 25), more: results.length > 25};
    },
    async recordEmailSent(id, previous) {
      const now = new Date().toISOString();
      const updated = await db.prepare(`
        UPDATE campaign_briefs SET email_delivered_at = ?
        WHERE checkout_session_id = ? AND email_delivered_at IS ?
        RETURNING email_delivered_at
      `).bind(now, id, previous).first();
      if (updated) return updated;
      return db.prepare("SELECT email_delivered_at FROM campaign_briefs WHERE checkout_session_id = ?")
        .bind(id).first();
    }
  };
}
