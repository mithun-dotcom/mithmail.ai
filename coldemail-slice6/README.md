# Slice 6 — THE SENDING ENGINE + Schedule + Options + Start button

Your tool now actually sends campaigns.

## What's new
- engine.js (NEW): a loop that runs every 45s inside your server. For each
  ACTIVE campaign it checks: is now inside the send window, in the campaign's
  timezone, on an allowed day, under the daily limit? If yes, each selected
  healthy inbox that's past its randomized 3-12 minute gap sends ONE email:
  variables rendered, follow-ups threaded (In-Reply-To/References), recorded
  in the messages table, next step auto-scheduled after its delay_days.
  Failures are classified: auth error -> inbox marked reconnect_needed and the
  email retried later; hard bounce -> lead marked bounced, rest cancelled;
  transient -> retry in 45 min.
- Campaign start: POST /campaigns/:id/start plans step 1 for every lead,
  assigns each lead a sticky inbox (round-robin), sets status active. It
  refuses with a clear message if no inboxes are selected, step 1 is empty,
  or there are no leads.
- Schedule settings: timezone (IANA, validated), send window hours, days.
- Options: stop-on-reply flag (takes effect when Unibox lands), campaign
  daily limit.
- Migration is automatic: new columns/tables are added on startup, your
  existing data is preserved.

## Update on Render
Replace/upload in your GitHub repo:
  - server.js  (replaced)
  - db.js      (replaced)
  - engine.js  (NEW — don't forget this one!)
package.json unchanged. Watch logs for:
  "Database ready: all tables exist."
  "Sending engine running (tick every 45s)."

## IMPORTANT — first run safely
Test with a TINY campaign first: 2-3 leads that are YOUR OWN email
addresses, 1 inbox, daily limit 5. Press Start, wait a few minutes,
confirm the emails arrive and look right (variables filled, threading on
step 2). Only then trust it with a real lead list. An engine bug with
8,000 real leads queued is not a place you want to discover it.
