import { pool } from './db.js';

export async function campaignAnalytics(campaignId) {
  const c = (await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [campaignId])).rows[0];
  if (!c) throw new Error('Campaign not found.');
  const tz = c.timezone || 'UTC';

  // headline counters
  const leads = (await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM leads WHERE campaign_id=$1 GROUP BY status`,
    [campaignId])).rows;
  const L = Object.fromEntries(leads.map(r => [r.status, r.n]));
  const totalLeads = leads.reduce((a, r) => a + r.n, 0);

  const q = (await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM scheduled_emails WHERE campaign_id=$1 GROUP BY status`,
    [campaignId])).rows;
  const Q = Object.fromEntries(q.map(r => [r.status, r.n]));

  const sent = Q.sent || 0;
  const replied = L.replied || 0;
  const bounced = L.bounced || 0;
  const started = totalLeads - (L.pending || 0);   // leads that entered the sequence

  const sentToday = Number((await pool.query(
    `SELECT COUNT(*) FROM scheduled_emails WHERE campaign_id=$1 AND status='sent'
       AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
    [campaignId, tz])).rows[0].count);

  // 30-day daily series (sent + replies received)
  const series = (await pool.query(
    `WITH days AS (
       SELECT generate_series((now() AT TIME ZONE $2)::date - interval '29 days',
                              (now() AT TIME ZONE $2)::date, interval '1 day')::date AS d)
     SELECT to_char(days.d,'Mon DD') AS label, days.d AS day,
       COALESCE((SELECT COUNT(*) FROM scheduled_emails se
          WHERE se.campaign_id=$1 AND se.status='sent'
            AND (se.sent_at AT TIME ZONE $2)::date = days.d),0)::int AS sent,
       COALESCE((SELECT COUNT(*) FROM messages m
          WHERE m.campaign_id=$1 AND m.direction='inbound'
            AND (m.created_at AT TIME ZONE $2)::date = days.d),0)::int AS replies
     FROM days ORDER BY days.d`, [campaignId, tz])).rows;

  // per-step breakdown
  const steps = (await pool.query(
    `SELECT ss.step_number,
       COUNT(se.id) FILTER (WHERE se.status='sent')::int AS sent,
       COUNT(se.id) FILTER (WHERE se.status='pending')::int AS pending,
       COUNT(se.id) FILTER (WHERE se.status='failed')::int AS failed
     FROM sequence_steps ss
     LEFT JOIN scheduled_emails se ON se.step_id = ss.id
     WHERE ss.campaign_id=$1
     GROUP BY ss.step_number ORDER BY ss.step_number`, [campaignId])).rows;

  // per-inbox breakdown (today + total)
  const inboxes = (await pool.query(
    `SELECT ea.id, ea.email,
       COUNT(se.id) FILTER (WHERE se.status='sent')::int AS total_sent,
       COUNT(se.id) FILTER (WHERE se.status='sent'
         AND (se.sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS sent_today,
       COUNT(se.id) FILTER (WHERE se.status='pending')::int AS queued,
       ea.next_send_at
     FROM email_accounts ea
     JOIN campaign_accounts ca ON ca.account_id = ea.id AND ca.campaign_id=$1
     LEFT JOIN scheduled_emails se ON se.account_id = ea.id AND se.campaign_id=$1
     GROUP BY ea.id, ea.email, ea.next_send_at ORDER BY ea.email`,
    [campaignId, tz])).rows;

  // recent failures
  const failures = (await pool.query(
    `SELECT error, COUNT(*)::int AS n FROM scheduled_emails
     WHERE campaign_id=$1 AND error IS NOT NULL
     GROUP BY error ORDER BY n DESC LIMIT 5`, [campaignId])).rows;

  const pct = (a,b) => b ? +(a/b*100).toFixed(2) : 0;
  return {
    ok: true,
    campaign: { id:c.id, name:c.name, status:c.status, timezone:tz,
                per_inbox_daily_limit:c.per_inbox_daily_limit, send_gap_minutes:c.send_gap_minutes },
    totals: {
      leads: totalLeads, started, sent, queued: Q.pending||0, failed: Q.failed||0,
      replied, bounced, completed: L.completed||0, sentToday,
      replyRate: pct(replied, sent), bounceRate: pct(bounced, sent),
    },
    series, steps, inboxes, failures,
  };
}
