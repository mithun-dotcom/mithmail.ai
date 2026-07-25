import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { pool } from './db.js';

// Derive IMAP settings from SMTP when the user didn't provide them.
// Works for Gmail (smtp.gmail.com -> imap.gmail.com) and most providers.
export function deriveImap(account) {
  if (account.imap_host) return { host: account.imap_host, port: account.imap_port || 993 };
  if (account.smtp_host?.startsWith('smtp.')) {
    return { host: account.smtp_host.replace(/^smtp\./, 'imap.'), port: 993 };
  }
  return null;
}

// Classify + store one inbound email. Exported for testability.
export async function processInbound(parsed, account) {
  const msgId = parsed.messageId || null;
  if (msgId) {
    const dupe = await pool.query(
      `SELECT 1 FROM messages WHERE message_id=$1 AND direction='inbound' LIMIT 1`, [msgId]);
    if (dupe.rows.length) return null;   // already stored
  }

  const fromAddr = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  const fromName = parsed.from?.value?.[0]?.name || null;
  const inReplyTo = parsed.inReplyTo || null;
  const refs = Array.isArray(parsed.references) ? parsed.references
             : (parsed.references ? [parsed.references] : []);

  // auto-reply / bounce detection
  const h = parsed.headers;
  const isAuto =
    (h.get('auto-submitted') || '').toString().toLowerCase().includes('auto') ||
    h.has('x-autoreply') || h.has('x-autorespond') ||
    /^(automatic reply|auto reply|auto-reply|out of office)/i.test(parsed.subject || '') ||
    /mailer-daemon|postmaster/i.test(fromAddr);

  // --- match against our own sent mail ---
  const candidates = [inReplyTo, ...refs].filter(Boolean);
  let original = null;
  if (candidates.length) {
    const r = await pool.query(
      `SELECT * FROM messages WHERE message_id = ANY($1) AND direction='outbound'
       ORDER BY created_at DESC LIMIT 1`, [candidates]);
    original = r.rows[0] || null;
  }
  if (!original && fromAddr) {
    // fallback: sender address matches a lead this inbox has emailed
    const r = await pool.query(
      `SELECT m.* FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE l.email = $1 AND m.account_id = $2 AND m.direction='outbound'
       ORDER BY m.created_at DESC LIMIT 1`, [fromAddr, account.id]);
    original = r.rows[0] || null;
  }

  const category = original ? 'primary' : 'other';

  const stored = await pool.query(
    `INSERT INTO messages (account_id, campaign_id, lead_id, direction, message_id,
       in_reply_to, references_header, subject, body, from_email, from_name, to_email,
       category, created_at)
     VALUES ($1,$2,$3,'inbound',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [account.id, original?.campaign_id || null, original?.lead_id || null,
     msgId, inReplyTo, refs.join(' ') || null,
     parsed.subject || '(no subject)',
     parsed.html || (parsed.text || '').replace(/\n/g, '<br>'),
     fromAddr, fromName, account.email, category,
     parsed.date || new Date()]);

  // real reply from a campaign lead -> mark replied + stop-on-reply
  if (original && original.lead_id && !isAuto) {
    await pool.query(`UPDATE leads SET status='replied' WHERE id=$1`, [original.lead_id]);
    if (original.campaign_id) {
      const c = await pool.query(`SELECT stop_on_reply FROM campaigns WHERE id=$1`, [original.campaign_id]);
      if (c.rows[0]?.stop_on_reply) {
        await pool.query(
          `UPDATE scheduled_emails SET status='cancelled'
           WHERE lead_id=$1 AND status='pending'`, [original.lead_id]);
      }
    }
  }
  return stored.rows[0];
}

// Poll one account's INBOX for new mail since last_imap_uid.
async function pollAccount(account) {
  const imap = deriveImap(account);
  if (!imap) return;

  const client = new ImapFlow({
    host: imap.host, port: imap.port, secure: true,
    auth: { user: account.smtp_user, pass: account.smtp_pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const lastUid = Number(account.last_imap_uid) || 0;
      if (lastUid === 0) {
        // first run: don't import history — just record the current high-water mark
        const status = await client.status('INBOX', { uidNext: true });
        await pool.query(`UPDATE email_accounts SET last_imap_uid=$1, imap_error=NULL WHERE id=$2`,
          [(status.uidNext || 1) - 1, account.id]);
        return;
      }
      let maxUid = lastUid;
      for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= lastUid) continue;   // some servers echo the anchor uid
        maxUid = Math.max(maxUid, msg.uid);
        try {
          const parsed = await simpleParser(msg.source);
          await processInbound(parsed, account);
        } catch (e) {
          console.error(`Parse failed (${account.email} uid ${msg.uid}):`, e.message);
        }
      }
      if (maxUid > lastUid) {
        await pool.query(`UPDATE email_accounts SET last_imap_uid=$1, imap_error=NULL WHERE id=$2`,
          [maxUid, account.id]);
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch {}
    await pool.query(`UPDATE email_accounts SET imap_error=$1 WHERE id=$2`,
      [err.message.slice(0, 200), account.id]);
    console.error(`IMAP poll failed (${account.email}):`, err.message);
  }
}

let polling = false;
export async function pollAllInboxes() {
  if (polling) return;
  polling = true;
  try {
    const accounts = (await pool.query(
      `SELECT * FROM email_accounts WHERE status='active' AND provider='smtp'`)).rows;
    for (const account of accounts) {
      await pollAccount(account);
    }
  } catch (err) {
    console.error('Inbound poll error:', err.message);
  } finally {
    polling = false;
  }
}

export function startInboundPolling() {
  setInterval(pollAllInboxes, 2 * 60 * 1000);   // every 2 minutes
  setTimeout(pollAllInboxes, 10 * 1000);        // first pass shortly after boot
  console.log('Inbound polling running (every 2 min).');
}
