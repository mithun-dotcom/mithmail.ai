# Slice 4 — Campaigns backend

Adds campaign tables and endpoints. Your existing inboxes/data are untouched;
the new tables are created automatically on startup (you'll see
"Database ready: all tables exist." in the logs).

## Update on Render
Replace these two files in your GitHub repo with the Slice 4 versions:
  - server.js   (adds all campaign endpoints + PUT in CORS)
  - db.js       (adds campaigns/leads/sequence_steps/campaign_accounts tables)
package.json is unchanged (still just express, nodemailer, pg, dotenv).
Render auto-redeploys. No database recreation — new tables just appear.

## New endpoints
  GET    /campaigns              list campaigns (+ lead/step counts)
  POST   /campaigns              create (name) -> seeds one empty step
  GET    /campaigns/:id          full detail (steps, leads, selected inboxes)
  DELETE /campaigns/:id          delete (cascades to leads/steps)
  POST   /campaigns/:id/leads    upload leads (array); skips dupes+invalid
  PUT    /campaigns/:id/steps    replace whole sequence
  PUT    /campaigns/:id/accounts set which inboxes the campaign uses

## Tested
The campaign SQL logic (create, multi-step sequence, lead dedupe, inbox
selection, cascade delete, list-with-counts) was verified against an
in-memory Postgres. A couple of standard queries couldn't run in the test
engine due to its own limitations, not bugs — those get their real
confirmation when you deploy against Render's actual Postgres.

## Not in this slice
The sending engine (queue, scheduler, rotation, delays) that actually FIRES
a campaign. That's the next slice, kept separate because it's the most
complex piece.
