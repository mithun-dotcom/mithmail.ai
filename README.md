# Slice 2 — Store inboxes in a database and send from them

Builds on Slice 1. New in this slice:
- A real database (Render Postgres) instead of env-var credentials
- Connect multiple inboxes, saved as rows
- Send from whichever inbox you pick

You do NOT run any SQL by hand — the backend creates its table automatically
on startup.

===========================================================================
PART A — Update the backend on Render
===========================================================================

You can either replace the files in your existing GitHub repo, or make a new
repo. Replacing the existing one is simplest.

1. On GitHub, open your repo -> upload/replace these files with the Slice 2
   versions:
       server.js      (rewritten)
       db.js          (NEW)
       package.json   (now includes "pg")
   Commit the changes. Render auto-redeploys, but it will fail until you add
   the database in the next step — that's expected.

===========================================================================
PART B — Add a Postgres database on Render
===========================================================================

1. In the Render dashboard, click "New" -> "Postgres".
2. Give it a name (e.g. coldemail-db). Pick the FREE plan. Region: same as
   your web service if possible. Click "Create Database".
3. Wait until it's "Available".

Now connect it to your web service:

4. Open your web service (mithmail-ai) -> "Environment".
5. You need the database's connection string. Two ways:
      EASIEST: Render can link them for you. On the web service, look for
      "Environment" and see if there's an option to add a database / link a
      Postgres instance, which auto-creates DATABASE_URL.

      MANUAL: open your Postgres instance -> "Connect" -> copy the
      "Internal Database URL". Back in the web service Environment, add:
          KEY:   DATABASE_URL
          VALUE: (paste the Internal Database URL)
   Use the INTERNAL url (not external) since both run on Render.
6. Save. The web service redeploys.

7. Watch the logs (web service -> "Logs"). You should see:
       Database ready: email_accounts table exists.
       Server listening on port ...
   That means the DB connected and the table was created automatically.

Your OLD env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) are no longer
needed for sending — credentials now live in the database. You can leave them
or delete them; they're ignored now.

===========================================================================
PART C — Update the frontend on Netlify
===========================================================================

1. Unzip the frontend folder.
2. Go to https://app.netlify.com/drop and drag the folder on
   (or update your existing Netlify site by dragging the new folder).
   Still static, still no build credits used.
3. Open the Netlify URL.

===========================================================================
PART D — Test the full flow
===========================================================================

1. Paste your Render backend URL into the top box.
2. Under "Connect an inbox", enter a Gmail + its App Password (same kind you
   used in Slice 1). Click "Connect inbox".
      - The backend VERIFIES the credentials before saving. If they're wrong,
        you get an error and nothing is saved. If right, it appears in the list.
3. Click "Refresh list" — your inbox shows up (pulled from the database).
4. Under "Send a test email", pick the inbox, enter a recipient, send.
5. Check the inbox — email arrives, sent from your chosen account.

To really prove the database works: connect a SECOND inbox (another Gmail +
App Password). Both appear in the list and both are selectable to send from.

===========================================================================
What this proves
===========================================================================
Inboxes are now stored in and sent from a real database — the core of a
multi-inbox tool. The table already has a "provider" column and an
"oauth_refresh_token" column, so the NEXT slice (OAuth) drops straight in
with no schema changes.

Security note: SMTP passwords are stored as plain text in this slice to keep
it simple. Before real users, we add encryption (the AES-256-GCM step from
our earlier design). Fine for your own test accounts now; not for production.
