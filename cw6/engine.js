import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { pool } from './db.js';

// ---------- timezone helpers (no libraries needed) ----------
// Returns { dow: 1..7 (Mon..Sun), hour: 0..23 } for "now" in the given IANA tz.
export function nowInTz(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, weekday: 'short', hour: 'numeric',
    }).formatToParts(new Date());
    const wd = parts.find(p => p.type === 'weekday').value;
    let hour = Number(parts.find(p => p.type === 'hour').value);
    if (hour === 24) hour = 0; // some ICU versions return 24 at midnight
    const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return { dow: map[wd], hour };
  } catch {
    // bad timezone string -> treat as UTC so the campaign doesn't silently die
    return nowInTz('UTC');
  }
}

export function isWithinWindow(campaign) {
  const { dow, hour } = nowInTz(campaign.timezone || 'UTC');
  if (!campaign.send_days.includes(dow)) return false;
  return hour >= campaign.send_window_start && hour < campaign.send_window_end;
}

// ---------- rendering ----------
export function renderTemplate(text, lead) {
  const vars = {
    firstName: lead.first_name || '', lastName: lead.last_name || '',
    company: lead.company || '', email: lead.email || '',
  };
  return (text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

// ---------- the tick ----------
// Runs every 45s. For each active campaign inside its window and under its
// daily limit, each assigned inbox that's past its pacing gap sends ONE email.
let ticking = false;

export async function tick() {
  if (ticking) return;          // don't overlap ticks
  ticking = true;
  try {
    const campaigns = (await pool.query(
      `SELECT * FROM campaigns WHERE status = 'active'`)).rows;

    for (const campaign of campaigns) {
      if (!isWithinWindow(campaign)) continue;

      const tz = campaign.timezone || 'UTC';
      // campaign-wide cap (a safety ceiling)
      const sentToday = Number((await pool.query(
        `SELECT COUNT(*) FROM scheduled_emails
         WHERE campaign_id = $1 AND status = 'sent'
           AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
        [campaign.id, tz])).rows[0].count);
      if (sentToday >= campaign.daily_limit) continue;
      let remaining = campaign.daily_limit - sentToday;

      // PER-INBOX daily counts — each inbox gets its own allowance
      const perInbox = {};
      for (const r of (await pool.query(
        `SELECT account_id, COUNT(*)::int AS n FROM scheduled_emails
         WHERE campaign_id = $1 AND status = 'sent'
           AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
         GROUP BY account_id`, [campaign.id, tz])).rows) perInbox[r.account_id] = r.n;

      // inboxes assigned to this campaign, healthy, and past their pacing gap
      const accounts = (await pool.query(
        `SELECT ea.* FROM email_accounts ea
         JOIN campaign_accounts ca ON ca.account_id = ea.id
         WHERE ca.campaign_id = $1 AND ea.status = 'active' AND ea.next_send_at <= now()
         ORDER BY ea.next_send_at`, [campaign.id])).rows;

      for (const account of accounts) {
        if (remaining <= 0) break;
        // this inbox's own daily allowance
        const cap = campaign.per_inbox_daily_limit || 20;
        if ((perInbox[account.id] || 0) >= cap) continue;

        const sent = await sendOneFor(campaign, account);
        if (sent) {
          remaining--;
          perInbox[account.id] = (perInbox[account.id] || 0) + 1;
          // YOUR configured gap, with +/-10% jitter so sends aren't robotic
          const base = campaign.send_gap_minutes || 3;
          const gapMin = base * (0.9 + Math.random() * 0.2);
          await pool.query(
            `UPDATE email_accounts SET next_send_at = now() + ($1 || ' minutes')::interval
             WHERE id = $2`, [gapMin.toFixed(2), account.id]);
        }
      }
    }
  } catch (err) {
    console.error('Engine tick error:', err.message);
  } finally {
    ticking = false;
  }
}

// Send the next due email for one inbox in one campaign. Returns true if sent.
async function sendOneFor(campaign, account) {
  const client = await pool.connect();
  let job;
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT se.id FROM scheduled_emails se
       JOIN leads l ON l.id = se.lead_id
       WHERE se.campaign_id = $1 AND se.account_id = $2
         AND se.status = 'pending' AND se.scheduled_for <= now()
         AND l.status IN ('pending','in_sequence')
       ORDER BY se.scheduled_for
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [campaign.id, account.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return false; }
    const jobId = r.rows[0].id;
    await client.query(
      `UPDATE scheduled_emails SET status = 'sending' WHERE id = $1`, [jobId]);
    await client.query('COMMIT');
    job = jobId;
  } catch (e) {
    await client.query('ROLLBACK');
    return false;
  } finally {
    client.release();
  }

  // load everything we need
  const se = (await pool.query(`SELECT * FROM scheduled_emails WHERE id=$1`, [job])).rows[0];
  const lead = (await pool.query(`SELECT * FROM leads WHERE id=$1`, [se.lead_id])).rows[0];
  const step = (await pool.query(`SELECT * FROM sequence_steps WHERE id=$1`, [se.step_id])).rows[0];

  try {
    let subject = renderTemplate(step.subject, lead);
    const body = renderTemplate(step.body, lead);

    // threading: follow-ups with a blank subject continue the previous thread
    let inReplyTo = null, references = null;
    if (step.step_number > 1) {
      const prev = (await pool.query(
        `SELECT * FROM messages WHERE lead_id=$1 AND direction='outbound'
         ORDER BY created_at DESC LIMIT 1`, [lead.id])).rows[0];
      if (prev) {
        inReplyTo = prev.message_id;
        references = ((prev.references_header || '') + ' ' + (prev.message_id || '')).trim();
        if (!subject) subject = prev.subject?.startsWith('Re:') ? prev.subject : 'Re: ' + (prev.subject || '');
      }
    }
    if (!subject) subject = '(no subject)';

    const messageId = `<${crypto.randomUUID()}@${account.email.split('@')[1]}>`;
    const transport = nodemailer.createTransport({
      host: account.smtp_host, port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.smtp_user, pass: account.smtp_pass },
    });

    await transport.sendMail({
      from: account.smtp_user, to: lead.email, subject,
      html: body.replace(/\n/g, '<br>'),
      messageId,
      ...(inReplyTo ? { inReplyTo, references } : {}),
    });

    await pool.query(
      `UPDATE scheduled_emails SET status='sent', sent_at=now() WHERE id=$1`, [se.id]);
    await pool.query(
      `INSERT INTO messages (account_id, campaign_id, lead_id, direction, message_id,
        in_reply_to, references_header, subject, body, from_email, to_email)
       VALUES ($1,$2,$3,'outbound',$4,$5,$6,$7,$8,$9,$10)`,
      [account.id, campaign.id, lead.id, messageId, inReplyTo, references,
       subject, body, account.smtp_user, lead.email]);
    await pool.query(
      `UPDATE leads SET status='in_sequence' WHERE id=$1 AND status='pending'`, [lead.id]);

    await scheduleNextStep(campaign, lead, step, account);
    console.log(`Sent: campaign=${campaign.id} step=${step.step_number} to=${lead.email} via=${account.email}`);
    return true;

  } catch (err) {
    const authErr = /auth|credential|login|password|535/i.test(err.message);
    const hardBounce = /550|553|5\.1\.1|user unknown|does not exist/i.test(err.message);
    if (authErr) {
      await pool.query(`UPDATE email_accounts SET status='reconnect_needed' WHERE id=$1`, [account.id]);
      await pool.query(`UPDATE scheduled_emails SET status='pending' WHERE id=$1`, [se.id]); // retry after fix
    } else if (hardBounce) {
      await pool.query(`UPDATE leads SET status='bounced' WHERE id=$1`, [se.lead_id]);
      await pool.query(`UPDATE scheduled_emails SET status='failed', error=$2 WHERE id=$1`, [se.id, err.message.slice(0,300)]);
      await pool.query(`UPDATE scheduled_emails SET status='cancelled'
        WHERE lead_id=$1 AND status='pending'`, [se.lead_id]);
    } else {
      // transient: retry in ~45 min
      await pool.query(`UPDATE scheduled_emails
        SET status='pending', scheduled_for = now() + interval '45 minutes', error=$2
        WHERE id=$1`, [se.id, err.message.slice(0,300)]);
    }
    console.error(`Send failed (${lead?.email}):`, err.message);
    return false;
  }
}

async function scheduleNextStep(campaign, lead, currentStep, account) {
  const next = (await pool.query(
    `SELECT * FROM sequence_steps WHERE campaign_id=$1 AND step_number=$2`,
    [campaign.id, currentStep.step_number + 1])).rows[0];
  if (!next) {
    await pool.query(`UPDATE leads SET status='completed' WHERE id=$1 AND status='in_sequence'`, [lead.id]);
    return;
  }
  await pool.query(
    `INSERT INTO scheduled_emails (campaign_id, lead_id, step_id, account_id, scheduled_for)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)
     ON CONFLICT (lead_id, step_id) DO NOTHING`,
    [campaign.id, lead.id, next.id, account.id, next.delay_days || 0]);
}

// ---------- queue repair ----------
// Re-points every PENDING email (and every lead's sticky inbox) at the
// inboxes currently selected for the campaign. Safe to run any time.
// This is what keeps changing your inbox selection from stranding the queue.
export async function repairQueue(campaignId) {
  const accounts = (await pool.query(
    `SELECT ea.id FROM email_accounts ea
     JOIN campaign_accounts ca ON ca.account_id = ea.id
     WHERE ca.campaign_id = $1 AND ea.status = 'active'
     ORDER BY ea.id`, [campaignId])).rows.map(r => r.id);
  if (!accounts.length) return { repaired: 0, reason: 'no active inboxes selected' };

  // leads whose sticky inbox is missing or no longer selected
  const staleLeads = (await pool.query(
    `SELECT id FROM leads
     WHERE campaign_id = $1
       AND (assigned_account_id IS NULL OR assigned_account_id <> ALL($2::int[]))`,
    [campaignId, accounts])).rows;
  let i = 0;
  for (const l of staleLeads) {
    await pool.query(`UPDATE leads SET assigned_account_id=$1 WHERE id=$2`,
      [accounts[i++ % accounts.length], l.id]);
  }

  // pending queue rows pointing at an inbox that isn't selected any more
  const stale = (await pool.query(
    `SELECT se.id, se.lead_id FROM scheduled_emails se
     WHERE se.campaign_id = $1 AND se.status = 'pending'
       AND (se.account_id IS NULL OR se.account_id <> ALL($2::int[]))`,
    [campaignId, accounts])).rows;
  let j = 0;
  for (const row of stale) {
    const lead = (await pool.query(`SELECT assigned_account_id FROM leads WHERE id=$1`, [row.lead_id])).rows[0];
    const acct = (lead && accounts.includes(lead.assigned_account_id))
      ? lead.assigned_account_id : accounts[j++ % accounts.length];
    await pool.query(`UPDATE scheduled_emails SET account_id=$1 WHERE id=$2`, [acct, row.id]);
  }
  // pull any future-dated pending rows forward to now
  const future = await pool.query(
    `UPDATE scheduled_emails SET scheduled_for = now()
     WHERE campaign_id = $1 AND status = 'pending' AND scheduled_for > now()`, [campaignId]);

  // un-stick leads whose status blocks sending but who have pending work
  // (leaves genuinely replied/bounced/unsubscribed leads alone)
  const unstuck = await pool.query(
    `UPDATE leads SET status='pending'
     WHERE campaign_id = $1
       AND status NOT IN ('pending','in_sequence','replied','bounced','unsubscribed')
       AND id IN (SELECT lead_id FROM scheduled_emails
                  WHERE campaign_id=$1 AND status='pending')`, [campaignId]);

  return { repaired: stale.length, leadsReassigned: staleLeads.length,
           pulledForward: future.rowCount, unstuckLeads: unstuck.rowCount };
}

// ---------- campaign start: plan step 1 for every unplanned lead ----------
export async function planCampaign(campaignId) {
  const accounts = (await pool.query(
    `SELECT ea.id FROM email_accounts ea
     JOIN campaign_accounts ca ON ca.account_id = ea.id
     WHERE ca.campaign_id = $1 AND ea.status = 'active'`, [campaignId])).rows;
  if (!accounts.length) throw new Error('No active inboxes selected for this campaign (Options tab).');

  const step1 = (await pool.query(
    `SELECT id FROM sequence_steps WHERE campaign_id=$1 AND step_number=1`, [campaignId])).rows[0];
  if (!step1) throw new Error('Campaign has no sequence steps.');
  const hasBody = (await pool.query(
    `SELECT 1 FROM sequence_steps WHERE campaign_id=$1 AND step_number=1 AND body <> ''`, [campaignId])).rows.length;
  if (!hasBody) throw new Error('Step 1 has no body — write your email in the Sequence tab.');

  const leads = (await pool.query(
    `SELECT id FROM leads WHERE campaign_id=$1 AND status IN ('pending','in_sequence')`, [campaignId])).rows;
  if (!leads.length) throw new Error('Campaign has no leads.');

  const validIds = accounts.map(a => a.id);
  let i = 0, planned = 0;
  for (const lead of leads) {
    const acct = accounts[i++ % accounts.length].id;
    // clear a sticky inbox that is no longer selected, then assign
    await pool.query(
      `UPDATE leads SET assigned_account_id=$1
       WHERE id=$2 AND (assigned_account_id IS NULL OR assigned_account_id <> ALL($3::int[]))`,
      [acct, lead.id, validIds]);
    const r = await pool.query(
      `INSERT INTO scheduled_emails (campaign_id, lead_id, step_id, account_id, scheduled_for)
       VALUES ($1,$2,$3,COALESCE((SELECT assigned_account_id FROM leads WHERE id=$2), $4), now())
       ON CONFLICT (lead_id, step_id) DO NOTHING`,
      [campaignId, lead.id, step1.id, acct]);
    planned += r.rowCount;
  }
  // Stagger the inboxes so they don't all fire at the same instant:
  // inbox 1 sends now, inbox 2 after gap/N, inbox 3 after 2*gap/N, ...
  const camp = (await pool.query(`SELECT send_gap_minutes FROM campaigns WHERE id=$1`, [campaignId])).rows[0];
  const gap = camp?.send_gap_minutes || 3;
  const stepMin = accounts.length > 1 ? gap / accounts.length : 0;
  for (let k = 0; k < accounts.length; k++) {
    await pool.query(
      `UPDATE email_accounts SET next_send_at = now() + ($1 || ' minutes')::interval WHERE id = $2`,
      [(k * stepMin).toFixed(2), accounts[k].id]);
  }

  const fixed = await repairQueue(campaignId);
  return { leads: leads.length, planned, repaired: fixed.repaired, inboxes: accounts.length };
}

export function startEngine() {
  setInterval(tick, 45 * 1000);
  console.log('Sending engine running (tick every 45s).');
}
