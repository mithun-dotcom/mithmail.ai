import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import { pool, initDb } from './db.js';

const app = express();
app.use(express.json());

// CORS — allow the Netlify frontend to call this backend.
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', allowed);
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.send('Backend running. Endpoints: POST /inboxes, GET /inboxes, POST /send-test');
});

// --- Connect (save) an inbox -------------------------------------------------
// Body: { email, smtp_host, smtp_port, smtp_user, smtp_pass }
app.post('/inboxes', async (req, res) => {
  const { email, smtp_host, smtp_port, smtp_user, smtp_pass } = req.body;

  if (!email || !smtp_host || !smtp_port || !smtp_user || !smtp_pass) {
    return res.status(400).json({ ok: false, error: 'All fields are required.' });
  }

  try {
    // Verify the credentials actually work BEFORE saving them.
    const transport = nodemailer.createTransport({
      host: smtp_host,
      port: Number(smtp_port),
      secure: Number(smtp_port) === 465,
      auth: { user: smtp_user, pass: smtp_pass },
    });
    await transport.verify(); // throws if credentials are wrong

    // Save (or update if this email already exists).
    const result = await pool.query(
      `INSERT INTO email_accounts (email, provider, smtp_host, smtp_port, smtp_user, smtp_pass, status)
       VALUES ($1, 'smtp', $2, $3, $4, $5, 'active')
       ON CONFLICT (email) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         smtp_user = EXCLUDED.smtp_user,
         smtp_pass = EXCLUDED.smtp_pass,
         status = 'active'
       RETURNING id, email, provider, status, created_at`,
      [email, smtp_host, Number(smtp_port), smtp_user, smtp_pass]
    );

    res.json({ ok: true, inbox: result.rows[0] });
  } catch (err) {
    res.status(400).json({ ok: false, error: 'Could not connect: ' + err.message });
  }
});

// --- List connected inboxes --------------------------------------------------
// Never returns passwords — only safe fields.
app.get('/inboxes', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, provider, status, created_at
       FROM email_accounts ORDER BY created_at DESC`
    );
    res.json({ ok: true, inboxes: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Delete an inbox ---------------------------------------------------------
app.delete('/inboxes/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM email_accounts WHERE id = $1 RETURNING email`, [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Inbox not found.' });
    }
    res.json({ ok: true, deleted: result.rows[0].email });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Send a test email FROM a chosen connected inbox -------------------------
// Body: { inboxId, to }
app.post('/send-test', async (req, res) => {
  const { inboxId, to } = req.body;
  if (!inboxId || !to) {
    return res.status(400).json({ ok: false, error: 'inboxId and to are required.' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM email_accounts WHERE id = $1`, [inboxId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Inbox not found.' });
    }
    const inbox = result.rows[0];

    const transport = nodemailer.createTransport({
      host: inbox.smtp_host,
      port: inbox.smtp_port,
      secure: inbox.smtp_port === 465,
      auth: { user: inbox.smtp_user, pass: inbox.smtp_pass },
    });

    const info = await transport.sendMail({
      from: inbox.smtp_user,
      to,
      subject: 'Test from ' + inbox.email,
      html: `<h2>Success 🎉</h2><p>Sent from your connected inbox: <b>${inbox.email}</b></p>`,
    });

    res.json({ ok: true, messageId: info.messageId, from: inbox.email, to });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start: init DB first, then listen.
const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to init database:', err.message);
    process.exit(1);
  });
