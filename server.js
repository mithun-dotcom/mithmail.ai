import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';

const app = express();
app.use(express.json());

// Allow the Netlify frontend (a different domain) to call this backend.
// For this test we allow any origin. Later, lock this to your exact
// Netlify URL by setting ALLOWED_ORIGIN in Render's env vars.
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', allowed);
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204); // preflight
  next();
});

function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// A tiny web page with a form, so you can test entirely from a browser.
// No terminal, no curl needed.
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Send Test Email</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; }
        input { width: 100%; padding: 12px; font-size: 16px; margin: 8px 0; box-sizing: border-box; }
        button { width: 100%; padding: 14px; font-size: 16px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
        button:disabled { background: #9ca3af; }
        #result { margin-top: 16px; padding: 12px; border-radius: 6px; white-space: pre-wrap; }
        .ok { background: #dcfce7; color: #166534; }
        .err { background: #fee2e2; color: #991b1b; }
      </style>
    </head>
    <body>
      <h2>Send a test email</h2>
      <p>Enter an address and click send. If your SMTP settings are correct, the email arrives in that inbox.</p>
      <input id="to" type="email" placeholder="you@example.com" />
      <button id="btn" onclick="send()">Send test email</button>
      <div id="result"></div>
      <script>
        async function send() {
          const btn = document.getElementById('btn');
          const result = document.getElementById('result');
          const to = document.getElementById('to').value;
          btn.disabled = true; btn.textContent = 'Sending...';
          result.className = ''; result.textContent = '';
          try {
            const r = await fetch('/send-test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to })
            });
            const data = await r.json();
            if (data.ok) {
              result.className = 'ok';
              result.textContent = 'Sent! Check the inbox for ' + data.to + '\\nMessage ID: ' + data.messageId;
            } else {
              result.className = 'err';
              result.textContent = 'Failed: ' + data.error;
            }
          } catch (e) {
            result.className = 'err';
            result.textContent = 'Request failed: ' + e.message;
          }
          btn.disabled = false; btn.textContent = 'Send test email';
        }
      </script>
    </body>
    </html>
  `);
});

app.post('/send-test', async (req, res) => {
  const to = req.body.to || process.env.SMTP_USER;
  try {
    const transport = makeTransport();
    const info = await transport.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: 'It works! Test email from your backend',
      html: '<h2>Success 🎉</h2><p>Your backend connected to SMTP and sent this email.</p>',
    });
    console.log('Email sent:', info.messageId);
    res.json({ ok: true, messageId: info.messageId, to });
  } catch (err) {
    console.error('Send failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
