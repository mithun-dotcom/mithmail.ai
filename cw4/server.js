import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import { pool, initDb } from './db.js';
import { startEngine, planCampaign, renderTemplate, repairQueue } from './engine.js';
import { startInboundPolling } from './inbound.js';
import { diagnose, forceSendOne } from './diagnose.js';
import crypto from 'crypto';

const app = express();
app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', allowed);
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile('index.html', { root: 'public' }));

// ============================================================================
// INBOXES (unchanged behavior)
// ============================================================================
app.post('/inboxes', async (req, res) => {
  const { email, smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;
  if (!email || !smtp_host || !smtp_port || !smtp_user || !smtp_pass) {
    return res.status(400).json({ ok: false, error: 'All fields are required.' });
  }
  try {
    const transport = nodemailer.createTransport({
      host: smtp_host, port: Number(smtp_port),
      secure: Number(smtp_port) === 465,
      auth: { user: smtp_user, pass: smtp_pass },
    });
    await transport.verify();
    const result = await pool.query(
      `INSERT INTO email_accounts (email, provider, smtp_host, smtp_port, smtp_user, smtp_pass, status)
       VALUES ($1,'smtp',$2,$3,$4,$5,'active')
       ON CONFLICT (email) DO UPDATE SET
         smtp_host=EXCLUDED.smtp_host, smtp_port=EXCLUDED.smtp_port,
         smtp_user=EXCLUDED.smtp_user, smtp_pass=EXCLUDED.smtp_pass, status='active'
       RETURNING id, email, provider, status, created_at`,
      [email, smtp_host, Number(smtp_port), smtp_user, smtp_pass]);
    res.json({ ok: true, inbox: result.rows[0] });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Could not connect: ' + err.message });
  }
});

app.get('/inboxes', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ea.id, ea.email, ea.provider, ea.status, ea.created_at,
        (SELECT COUNT(*) FROM messages m WHERE m.account_id = ea.id
          AND m.direction='outbound' AND m.created_at::date = now()::date) AS sent_today
       FROM email_accounts ea ORDER BY ea.created_at DESC`);
    res.json({ ok: true, inboxes: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/inboxes/:id', async (req, res) => {
  try {
    const result = await pool.query(`DELETE FROM email_accounts WHERE id=$1 RETURNING email`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Inbox not found.' });
    res.json({ ok: true, deleted: result.rows[0].email });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/send-test', async (req, res) => {
  const { inboxId, to } = req.body;
  if (!inboxId || !to) return res.status(400).json({ ok: false, error: 'inboxId and to are required.' });
  try {
    const result = await pool.query(`SELECT * FROM email_accounts WHERE id=$1`, [inboxId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Inbox not found.' });
    const inbox = result.rows[0];
    const transport = nodemailer.createTransport({
      host: inbox.smtp_host, port: inbox.smtp_port,
      secure: inbox.smtp_port === 465,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    });
    const info = await transport.sendMail({
      from: inbox.smtp_user, to,
      subject: 'Test from ' + inbox.email,
      html: `<h2>Success 🎉</h2><p>Sent from: <b>${inbox.email}</b></p>`,
    });
    res.json({ ok: true, messageId: info.messageId, from: inbox.email, to });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ============================================================================
// CAMPAIGNS
// ============================================================================
app.get('/campaigns', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.status, c.created_at,
        COUNT(DISTINCT l.id) AS lead_count,
        COUNT(DISTINCT s.id) AS step_count,
        COUNT(DISTINCT se.id) FILTER (WHERE se.status='sent') AS sent_count,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status='replied') AS replied_count
      FROM campaigns c
      LEFT JOIN leads l ON l.campaign_id = c.id
      LEFT JOIN sequence_steps s ON s.campaign_id = c.id
      LEFT JOIN scheduled_emails se ON se.campaign_id = c.id
      GROUP BY c.id, c.name, c.status, c.created_at
      ORDER BY c.created_at DESC
    `);
    res.json({ ok: true, campaigns: result.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/campaigns', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'Campaign name is required.' });
  try {
    const c = await pool.query(`INSERT INTO campaigns (name, status) VALUES ($1,'draft') RETURNING *`, [name.trim()]);
    await pool.query(
      `INSERT INTO sequence_steps (campaign_id, step_number, subject, body, delay_days)
       VALUES ($1, 1, '', '', 0)`, [c.rows[0].id]);
    res.json({ ok: true, campaign: c.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/campaigns/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const c = await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [id]);
    if (!c.rows.length) return res.status(404).json({ ok: false, error: 'Campaign not found.' });

    const steps = await pool.query(`SELECT * FROM sequence_steps WHERE campaign_id=$1 ORDER BY step_number`, [id]);
    const leads = await pool.query(
      `SELECT id, email, first_name, last_name, company, status
       FROM leads WHERE campaign_id=$1 ORDER BY id DESC LIMIT 200`, [id]);
    const leadCount = await pool.query(`SELECT COUNT(*) FROM leads WHERE campaign_id=$1`, [id]);
    const selected = await pool.query(`SELECT account_id FROM campaign_accounts WHERE campaign_id=$1`, [id]);
    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='sent') AS sent,
         COUNT(*) FILTER (WHERE status='pending') AS queued,
         COUNT(*) FILTER (WHERE status='failed') AS failed
       FROM scheduled_emails WHERE campaign_id=$1`, [id]);

    res.json({
      ok: true,
      campaign: c.rows[0],
      steps: steps.rows,
      leads: leads.rows,
      leadCount: Number(leadCount.rows[0].count),
      selectedAccountIds: selected.rows.map(r => r.account_id),
      stats: stats.rows[0],
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/campaigns/:id', async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM campaigns WHERE id=$1 RETURNING name`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Not found.' });
    res.json({ ok: true, deleted: r.rows[0].name });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---- Schedule + options settings ----
app.put('/campaigns/:id/settings', async (req, res) => {
  const { timezone, send_window_start, send_window_end, send_days, daily_limit, stop_on_reply } = req.body;
  try {
    // validate timezone with Intl; reject junk before it breaks the engine
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); }
    catch { return res.status(400).json({ ok: false, error: 'Invalid timezone.' }); }
    const ws = Number(send_window_start), we = Number(send_window_end);
    if (!(ws >= 0 && ws <= 23 && we >= 1 && we <= 24 && ws < we)) {
      return res.status(400).json({ ok: false, error: 'Send window must be within 0-24 and start before end.' });
    }
    if (!Array.isArray(send_days) || !send_days.length || send_days.some(d => d < 1 || d > 7)) {
      return res.status(400).json({ ok: false, error: 'Pick at least one send day.' });
    }
    const dl = Math.max(1, Math.min(2000, Number(daily_limit) || 30));
    const r = await pool.query(
      `UPDATE campaigns SET timezone=$1, send_window_start=$2, send_window_end=$3,
         send_days=$4, daily_limit=$5, stop_on_reply=$6
       WHERE id=$7 RETURNING *`,
      [timezone, ws, we, send_days, dl, !!stop_on_reply, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    res.json({ ok: true, campaign: r.rows[0] });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---- Start / pause ----
app.post('/campaigns/:id/start', async (req, res) => {
  try {
    const c = await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [req.params.id]);
    if (!c.rows.length) return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    const plan = await planCampaign(req.params.id);   // throws with a clear message if not ready
    await pool.query(`UPDATE campaigns SET status='active' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, ...plan });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const r = await pool.query(`UPDATE campaigns SET status='paused' WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---- Leads (batched) ----
app.post('/campaigns/:id/leads', async (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ ok: false, error: 'No leads provided.' });
  }
  try {
    const seen = new Set(); const clean = []; let invalid = 0;
    for (const lead of leads) {
      const email = (lead.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) { invalid++; continue; }
      if (seen.has(email)) continue;
      seen.add(email);
      clean.push({
        email,
        first_name: (lead.first_name || '').trim() || null,
        last_name: (lead.last_name || '').trim() || null,
        company: (lead.company || '').trim() || null,
      });
    }
    let inserted = 0;
    const BATCH = 500;
    for (let i = 0; i < clean.length; i += BATCH) {
      const batch = clean.slice(i, i + BATCH);
      const values = []; const params = []; let p = 1;
      for (const l of batch) {
        values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
        params.push(req.params.id, l.email, l.first_name, l.last_name, l.company);
      }
      const r = await pool.query(
        `INSERT INTO leads (campaign_id, email, first_name, last_name, company)
         VALUES ${values.join(',')}
         ON CONFLICT (campaign_id, email) DO NOTHING`, params);
      inserted += r.rowCount;
    }
    res.json({ ok: true, inserted, skipped: leads.length - inserted - invalid, invalid });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---- Sequence ----
app.put('/campaigns/:id/steps', async (req, res) => {
  const { steps } = req.body;
  if (!Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ ok: false, error: 'At least one step is required.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // don't delete steps that already have scheduled emails pointing at them —
    // update in place, add new, remove extras only if unreferenced
    await client.query(`DELETE FROM sequence_steps
      WHERE campaign_id=$1 AND step_number > $2
        AND id NOT IN (SELECT step_id FROM scheduled_emails WHERE campaign_id=$1)`,
      [req.params.id, steps.length]);
    let n = 1;
    for (const s of steps) {
      await client.query(
        `INSERT INTO sequence_steps (campaign_id, step_number, subject, body, delay_days)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (campaign_id, step_number) DO UPDATE
           SET subject=EXCLUDED.subject, body=EXCLUDED.body, delay_days=EXCLUDED.delay_days`,
        [req.params.id, n, s.subject || '', s.body || '', Number(s.delay_days) || 0]);
      n++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: steps.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// ---- Campaign inboxes ----
app.put('/campaigns/:id/accounts', async (req, res) => {
  const { accountIds } = req.body;
  if (!Array.isArray(accountIds)) return res.status(400).json({ ok: false, error: 'accountIds must be an array.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM campaign_accounts WHERE campaign_id=$1`, [req.params.id]);
    for (const aid of accountIds) {
      await client.query(
        `INSERT INTO campaign_accounts (campaign_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [req.params.id, aid]);
    }
    await client.query('COMMIT');
    // re-point any pending queue rows at the new selection so changing
    // inboxes never strands the queue
    let repaired = 0;
    try { repaired = (await repairQueue(req.params.id)).repaired || 0; } catch {}
    res.json({ ok: true, count: accountIds.length, repaired });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally { client.release(); }
});

// ============================================================================
// UNIBOX
// ============================================================================
// List inbound messages. category = primary (campaign replies) | other
app.get('/unibox', async (req, res) => {
  const category = req.query.category === 'other' ? 'other' : 'primary';
  try {
    const r = await pool.query(
      `SELECT m.id, m.subject, m.body, m.from_email, m.from_name, m.to_email,
              m.created_at, m.is_read, m.lead_id, m.campaign_id, m.account_id,
              c.name AS campaign_name, ea.email AS inbox_email
       FROM messages m
       LEFT JOIN campaigns c ON c.id = m.campaign_id
       LEFT JOIN email_accounts ea ON ea.id = m.account_id
       WHERE m.direction='inbound' AND m.category=$1
       ORDER BY m.created_at DESC LIMIT 100`, [category]);
    res.json({ ok: true, messages: r.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Full thread for a message (by lead if linked, else by address pair)
app.get('/unibox/thread/:id', async (req, res) => {
  try {
    const m = (await pool.query(`SELECT * FROM messages WHERE id=$1`, [req.params.id])).rows[0];
    if (!m) return res.status(404).json({ ok: false, error: 'Message not found.' });
    let thread;
    if (m.lead_id) {
      thread = await pool.query(
        `SELECT * FROM messages WHERE lead_id=$1 ORDER BY created_at`, [m.lead_id]);
    } else {
      thread = await pool.query(
        `SELECT * FROM messages WHERE account_id=$1
           AND (from_email=$2 OR to_email=$2) ORDER BY created_at`,
        [m.account_id, m.from_email]);
    }
    await pool.query(`UPDATE messages SET is_read=true WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, thread: thread.rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Reply — always sent FROM the inbox that received the message, threaded.
app.post('/unibox/reply', async (req, res) => {
  const { messageId, body } = req.body;
  if (!messageId || !body) return res.status(400).json({ ok: false, error: 'messageId and body are required.' });
  try {
    const m = (await pool.query(`SELECT * FROM messages WHERE id=$1 AND direction='inbound'`, [messageId])).rows[0];
    if (!m) return res.status(404).json({ ok: false, error: 'Message not found.' });
    const account = (await pool.query(`SELECT * FROM email_accounts WHERE id=$1`, [m.account_id])).rows[0];
    if (!account) return res.status(400).json({ ok: false, error: 'The inbox that received this no longer exists.' });

    const newId = `<${crypto.randomUUID()}@${account.email.split('@')[1]}>`;
    const subject = (m.subject || '').startsWith('Re:') ? m.subject : 'Re: ' + (m.subject || '');
    const references = ((m.references_header || '') + ' ' + (m.message_id || '')).trim();

    const transport = nodemailer.createTransport({
      host: account.smtp_host, port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.smtp_user, pass: account.smtp_pass },
    });
    await transport.sendMail({
      from: account.smtp_user, to: m.from_email, subject,
      html: body.replace(/\n/g, '<br>'),
      messageId: newId,
      inReplyTo: m.message_id || undefined,
      references: references || undefined,
    });
    await pool.query(
      `INSERT INTO messages (account_id, campaign_id, lead_id, direction, message_id,
         in_reply_to, references_header, subject, body, from_email, to_email, category, is_read)
       VALUES ($1,$2,$3,'outbound',$4,$5,$6,$7,$8,$9,$10,'primary',true)`,
      [account.id, m.campaign_id, m.lead_id, newId, m.message_id, references,
       subject, body, account.smtp_user, m.from_email]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---- Test email from the sequence editor ----
// Renders a step with a real lead's data (or sample data) and sends it.
app.post('/campaigns/:id/test-email', async (req, res) => {
  const { to, stepNumber, leadId, inboxId } = req.body;
  if (!to) return res.status(400).json({ ok: false, error: 'Recipient (to) is required.' });
  try {
    const step = (await pool.query(
      `SELECT * FROM sequence_steps WHERE campaign_id=$1 AND step_number=$2`,
      [req.params.id, Number(stepNumber) || 1])).rows[0];
    if (!step) return res.status(404).json({ ok: false, error: 'Step not found.' });

    let lead = null;
    if (leadId) lead = (await pool.query(`SELECT * FROM leads WHERE id=$1 AND campaign_id=$2`, [leadId, req.params.id])).rows[0];
    if (!lead) lead = (await pool.query(`SELECT * FROM leads WHERE campaign_id=$1 ORDER BY id LIMIT 1`, [req.params.id])).rows[0];
    if (!lead) lead = { first_name: 'Alex', last_name: 'Sample', company: 'Acme Inc', email: to };

    let account = null;
    if (inboxId) account = (await pool.query(`SELECT * FROM email_accounts WHERE id=$1`, [inboxId])).rows[0];
    if (!account) account = (await pool.query(
      `SELECT ea.* FROM email_accounts ea JOIN campaign_accounts ca ON ca.account_id=ea.id
       WHERE ca.campaign_id=$1 AND ea.status='active' LIMIT 1`, [req.params.id])).rows[0];
    if (!account) return res.status(400).json({ ok: false, error: 'No inbox available — select one in Options first.' });

    const subject = renderTemplate(step.subject, lead) || '(no subject)';
    const body = renderTemplate(step.body, lead);
    const transport = nodemailer.createTransport({
      host: account.smtp_host, port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: { user: account.smtp_user, pass: account.smtp_pass },
    });
    await transport.sendMail({
      from: account.smtp_user, to,
      subject: '[TEST] ' + subject,
      html: body.replace(/\n/g, '<br>'),
    });
    res.json({ ok: true, from: account.email, to, subject, body });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ---- DIAGNOSTICS ----
app.get('/campaigns/:id/diagnose', async (req, res) => {
  try { res.json(await diagnose(req.params.id)); }
  catch (err) { res.status(500).json({ ok:false, error: err.message }); }
});
app.post('/campaigns/:id/force-send', async (req, res) => {
  try { const r = await forceSendOne(req.params.id); res.json({ ok:true, ...r }); }
  catch (err) { res.status(400).json({ ok:false, error: err.message }); }
});

app.post('/campaigns/:id/repair', async (req, res) => {
  try { const r = await repairQueue(req.params.id); res.json({ ok: true, ...r }); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
    startEngine();
    startInboundPolling();
  })
  .catch((err) => {
    console.error('Failed to init database:', err.message);
    process.exit(1);
  });
