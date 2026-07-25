# Coldwave — your design, fully wired

Your uploaded design (icon rail, three-pane Unibox, card lists) is now the
real frontend, connected to the live API. The hardcoded demo data is gone;
everything reads and writes your database.

Kept from your design: layout, colors, typography, card style, filters panel.
Added in the same style (the mockup didn't have these):
  - Campaign detail with Leads / Sequence / Schedule / Options tabs
  - Start/Pause, CSV upload with column mapping, sequence test-email
  - SMTP connect flow (provider picker -> verify -> save), inbox delete
  - Unibox: real Primary/Others, unread highlighting, campaign & inbox
    filters in the left panel (wired, not decorative), thread view + reply
  - Row start/pause + delete on campaigns, live progress %, reply rate

## Deploy — replaces public/ in your GitHub repo
Files: server.js, db.js, engine.js, inbound.js, package.json (backend —
UNCHANGED from the previous coldwave zip; re-upload only if you never
deployed it), and public/ now contains THREE files:
    public/index.html
    public/app.js
    public/styles.css
Upload all three into the public folder. Render redeploys; open your
Render URL.

## STILL OPEN: the engine question
Last known state: "4 leads · 0 sent · 4 queued". The UI cannot fix that.
After deploying, check Render Logs for:
  "Sending engine running (tick every 45s)."  <- must exist at boot
  "Sent: campaign=..."                        <- actual sends
Set the campaign Schedule wide (e.g. 7:00 AM - 11:00 PM, all days,
Asia/Dhaka), Save, and watch the logs for 2-3 minutes.
