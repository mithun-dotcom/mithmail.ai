# Coldwave — your sending rules + campaign analytics

## What changed (this is what you asked for)
1. YOU set the gap. Options -> "Minutes between emails (per inbox)".
   Each inbox waits exactly that long after every send, then emails the next
   lead. A +/-10% jitter is added so sends don't look robotic to spam filters.
   (Before: a hardcoded random 3-12 minutes.)
2. PER-INBOX daily limit. Options -> "Emails per inbox per day".
   Set 20 and EACH inbox sends 20/day — 5 inboxes = 100 emails/day.
   (Before: one shared campaign-wide limit.)
3. Inboxes are STAGGERED at Start so they never fire simultaneously:
   with a 3 min gap and 3 inboxes, they go at 0:00, 1:00, 2:00, then repeat.
4. ANALYTICS tab (now the first tab on every campaign):
   - Sequence started / Emails sent (+today) / Replied (+rate) /
     Bounced (+rate) / Queued (+failed)
   - 30-day chart: sent bars with replies overlaid
   - By inbox: sent today vs its limit, total sent, queued, next send time
   - By step: sent / queued / failed per sequence step
   - Recent errors with the raw SMTP message

## Deploy — 6 files
  analytics.js      (NEW)
  db.js             (replaced — adds 2 columns, auto-migrates)
  engine.js         (replaced)
  server.js         (replaced)
  public/index.html (replaced — adds the Analytics tab)
  public/app.js     (replaced)
  public/styles.css (replaced)

## After deploying
1. Hard-refresh (Cmd+Shift+R).
2. Campaign -> Options -> set "Emails per inbox per day" (e.g. 20) and
   "Minutes between emails" (e.g. 3). SAVE.
3. Pause, then Start again so the inboxes get staggered.
4. Watch the Analytics tab. "By inbox" shows each inbox's next send time —
   that is the clearest proof the pacing is working.

## Expected pacing
2 inboxes, 3 min gap => roughly one email every 90 seconds overall.
20 per inbox per day => 40 emails/day total across 2 inboxes.
Sending genuinely IS slow. That slowness is what protects your domains.
