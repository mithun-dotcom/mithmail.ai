# Coldwave — with sending diagnostics

NEW: diagnose.js + a "🩺 Diagnose" button on every campaign.

## Why nothing sends — find out in 10 seconds
Open the campaign -> click "🩺 Diagnose". It walks EVERY gate the engine
checks and shows ✓ or ✗ with the actual values:
  - campaign active?
  - today an allowed send day? (shows current day IN the campaign timezone)
  - current time inside the window? (shows the actual local hour vs window)
  - inboxes selected? healthy? past their pacing gap?
  - under the daily limit?
  - emails queued? are the queued rows assigned to a still-selected inbox?
  - does step 1 have a body?
  - any recorded send errors? (shows the raw SMTP error)
It ends with a verdict: "All checks pass" or "BLOCKED BY: <the reason>".

## "Send one now"
Below the checks. Ignores schedule + pacing, verifies SMTP login, sends one
queued email immediately, and prints the RAW error if it fails.
This separates "schedule problem" from "SMTP problem" definitively:
  - Send one now WORKS  -> SMTP is fine; it's a schedule/window issue.
  - Send one now FAILS  -> the error text tells you exactly what's wrong
                           (bad app password, blocked login, etc).

## Deploy
Upload to your GitHub repo:
  diagnose.js   (NEW - required)
  server.js     (replaced - adds the 2 endpoints)
  public/app.js (replaced - adds the Diagnose UI)
  public/styles.css (replaced - adds check styles)
db.js, engine.js, inbound.js, package.json, public/index.html unchanged.
