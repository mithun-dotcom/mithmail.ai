# Slice 7 — UNIBOX + reply detection + test email + purple restyle

## What's new (backend)
- inbound.js (NEW): polls every connected inbox over IMAP every 2 minutes.
  IMAP settings are auto-derived from SMTP (smtp.gmail.com -> imap.gmail.com,
  port 993, same app password) — no re-entering credentials.
  First poll just records the current position; it does NOT import your
  mailbox history. From then on, every new email is:
    - matched against campaign sends via In-Reply-To/References headers
      (fallback: sender address matches a lead this inbox emailed)
    - matched -> PRIMARY, linked to its campaign + lead, lead marked
      "replied", and if stop-on-reply is on, their remaining steps are
      cancelled. Auto-replies/bounces detected and excluded from that.
    - unmatched -> OTHERS.
- Unibox endpoints: list by category, full thread view, and reply — replies
  always go out FROM the inbox that received the message, threaded properly.
- Test-email endpoint: renders any step with a real lead's data (or sample
  data), sends with a [TEST] subject prefix via the campaign's inbox.

## Update on Render — 4 files + package.json this time
  - server.js   (replaced)
  - db.js       (replaced)
  - engine.js   (unchanged but included)
  - inbound.js  (NEW)
  - package.json (REPLACED — adds imapflow + mailparser; without this the
    server will crash with "Cannot find module 'imapflow'")

## Test plan
1. After deploy, logs should show: Database ready / engine running /
   "Inbound polling running (every 2 min)."
2. Send a campaign email to one of your own addresses (or use the new
   test-send). REPLY to it from that address.
3. Within ~2-4 minutes it should appear in Unibox -> Primary, linked to
   the campaign. Reply from the UI; confirm it lands back, in-thread.
4. Send an unrelated email to a connected inbox -> appears under Others.
