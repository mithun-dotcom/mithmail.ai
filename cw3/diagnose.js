import nodemailer from 'nodemailer';
import { pool } from './db.js';
import { nowInTz, isWithinWindow, renderTemplate } from './engine.js';

// Walks every condition the engine checks, in order, and reports pass/fail.
export async function diagnose(campaignId) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  const c = (await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [campaignId])).rows[0];
  if (!c) return { ok: false, error: 'Campaign not found.' };

  // 1. status
  add('Campaign is active', c.status === 'active',
      `status = "${c.status}"` + (c.status !== 'active' ? ' — press Start campaign' : ''));

  // 2. schedule window
  const t = nowInTz(c.timezone || 'UTC');
  const dayNames = {1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri',6:'Sat',7:'Sun'};
  const dayOk = (c.send_days || []).includes(t.dow);
  const hourOk = t.hour >= c.send_window_start && t.hour < c.send_window_end;
  add('Today is an allowed send day', dayOk,
      `now = ${dayNames[t.dow]} in ${c.timezone}; allowed = [${(c.send_days||[]).map(d=>dayNames[d]).join(', ')}]`);
  add('Current time is inside the send window', hourOk,
      `now = ${String(t.hour).padStart(2,'0')}:xx in ${c.timezone}; window = ${c.send_window_start}:00–${c.send_window_end}:00`);

  // 3. inboxes attached to the campaign
  const accts = (await pool.query(
    `SELECT ea.id, ea.email, ea.status, ea.next_send_at, ea.smtp_host, ea.smtp_port, ea.smtp_user
     FROM email_accounts ea JOIN campaign_accounts ca ON ca.account_id = ea.id
     WHERE ca.campaign_id=$1`, [campaignId])).rows;
  add('Campaign has inboxes selected', accts.length > 0,
      accts.length ? accts.map(a=>a.email).join(', ') : 'none — pick one in the Options tab and Save');

  const activeAccts = accts.filter(a => a.status === 'active');
  add('At least one selected inbox is healthy', activeAccts.length > 0,
      accts.length ? accts.map(a=>`${a.email}: ${a.status}`).join(' | ') : 'n/a');

  const readyAccts = activeAccts.filter(a => new Date(a.next_send_at) <= new Date());
  add('An inbox is past its pacing gap', readyAccts.length > 0,
      activeAccts.map(a=>`${a.email}: next send ${new Date(a.next_send_at).toISOString()}`).join(' | ') || 'n/a');

  // 4. daily limit
  const sentToday = Number((await pool.query(
    `SELECT COUNT(*) FROM scheduled_emails
     WHERE campaign_id=$1 AND status='sent'
       AND (sent_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date`,
    [campaignId, c.timezone || 'UTC'])).rows[0].count);
  add('Under the daily limit', sentToday < c.daily_limit,
      `${sentToday} sent today of limit ${c.daily_limit}`);

  // 5. the queue itself
  const q = (await pool.query(
    `SELECT status, COUNT(*) FROM scheduled_emails WHERE campaign_id=$1 GROUP BY status`,
    [campaignId])).rows;
  const qmap = Object.fromEntries(q.map(r => [r.status, Number(r.count)]));
  add('Emails are queued', (qmap.pending || 0) > 0,
      q.length ? q.map(r=>`${r.status}: ${r.count}`).join(', ') : 'queue is empty — press Start campaign');

  // 6. queued rows actually claimable by a selected inbox
  const claimable = Number((await pool.query(
    `SELECT COUNT(*) FROM scheduled_emails se
     JOIN leads l ON l.id = se.lead_id
     WHERE se.campaign_id=$1 AND se.status='pending' AND se.scheduled_for <= now()
       AND l.status IN ('pending','in_sequence')
       AND se.account_id IN (SELECT account_id FROM campaign_accounts WHERE campaign_id=$1)`,
    [campaignId])).rows[0].count);
  add('Queued emails are assigned to a selected inbox', claimable > 0,
      `${claimable} row(s) claimable right now` +
      (claimable === 0 && (qmap.pending||0) > 0
        ? ' — queued rows point at an inbox that is no longer selected. Fix: Pause, re-Save Options, Start again.'
        : ''));

  // 7. step content
  const step1 = (await pool.query(
    `SELECT * FROM sequence_steps WHERE campaign_id=$1 AND step_number=1`, [campaignId])).rows[0];
  add('Step 1 has a body', !!(step1 && step1.body && step1.body.trim()),
      step1 ? `subject: "${(step1.subject||'').slice(0,40)}" body length: ${(step1.body||'').length}` : 'no step 1');

  // 8. recent errors
  const errs = (await pool.query(
    `SELECT error, COUNT(*) FROM scheduled_emails
     WHERE campaign_id=$1 AND error IS NOT NULL GROUP BY error ORDER BY COUNT(*) DESC LIMIT 3`,
    [campaignId])).rows;
  add('No send errors recorded', errs.length === 0,
      errs.length ? errs.map(e=>`${e.count}x ${e.error}`).join(' | ') : 'none');

  const blocking = checks.filter(c => !c.pass);
  return {
    ok: true,
    campaign: { id: c.id, name: c.name, status: c.status, timezone: c.timezone,
                window: `${c.send_window_start}:00-${c.send_window_end}:00`,
                serverTimeUtc: new Date().toISOString(),
                campaignLocalHour: t.hour, campaignLocalDay: dayNames[t.dow] },
    checks,
    verdict: blocking.length === 0
      ? 'All checks pass — the engine should send within ~45 seconds.'
      : 'BLOCKED BY: ' + blocking.map(b => b.name).join(' • '),
  };
}

// Force one send immediately, ignoring schedule/pacing. Returns the real error.
export async function forceSendOne(campaignId) {
  const c = (await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [campaignId])).rows[0];
  if (!c) throw new Error('Campaign not found.');

  const row = (await pool.query(
    `SELECT se.*, l.email AS lead_email, l.first_name, l.last_name, l.company
     FROM scheduled_emails se JOIN leads l ON l.id = se.lead_id
     WHERE se.campaign_id=$1 AND se.status='pending'
     ORDER BY se.scheduled_for LIMIT 1`, [campaignId])).rows[0];
  if (!row) throw new Error('Nothing pending in the queue. Press Start campaign first.');

  let account = row.account_id
    ? (await pool.query(`SELECT * FROM email_accounts WHERE id=$1`, [row.account_id])).rows[0]
    : null;
  if (!account) {
    account = (await pool.query(
      `SELECT ea.* FROM email_accounts ea JOIN campaign_accounts ca ON ca.account_id=ea.id
       WHERE ca.campaign_id=$1 AND ea.status='active' LIMIT 1`, [campaignId])).rows[0];
  }
  if (!account) throw new Error('No usable inbox. Select one in Options and Save.');

  const step = (await pool.query(`SELECT * FROM sequence_steps WHERE id=$1`, [row.step_id])).rows[0];
  if (!step) throw new Error('Sequence step missing.');

  const lead = { email: row.lead_email, first_name: row.first_name, last_name: row.last_name, company: row.company };
  const subject = renderTemplate(step.subject, lead) || '(no subject)';
  const body = renderTemplate(step.body, lead);
  if (!body.trim()) throw new Error('Step 1 body is empty — write your email in the Sequence tab and Save.');

  const transport = nodemailer.createTransport({
    host: account.smtp_host, port: account.smtp_port,
    secure: account.smtp_port === 465,
    auth: { user: account.smtp_user, pass: account.smtp_pass },
  });

  // verify first so credential problems surface clearly
  try { await transport.verify(); }
  catch (e) { throw new Error('SMTP connection/login failed: ' + e.message); }

  const info = await transport.sendMail({
    from: account.smtp_user, to: lead.email, subject,
    html: body.replace(/\n/g, '<br>'),
  });

  await pool.query(`UPDATE scheduled_emails SET status='sent', sent_at=now() WHERE id=$1`, [row.id]);
  await pool.query(`UPDATE leads SET status='in_sequence' WHERE id=$1 AND status='pending'`, [row.lead_id]);
  return { to: lead.email, from: account.email, subject, messageId: info.messageId };
}
