# Coldwave — single repo, single Render service

Everything in one place now. The backend serves the frontend, so:
- ONE GitHub repo (this folder's contents)
- ONE Render web service
- NO Netlify, NO "Backend URL" box — the app talks to itself.

## Structure
  server.js     API + serves the app
  db.js         schema (auto-migrates on boot)
  engine.js     sending engine
  inbound.js    IMAP reply detection
  package.json  dependencies
  public/
    index.html  the whole frontend

## Deploy (replaces your old setup)
1. In your GitHub repo, upload ALL of these files. The public/ folder matters:
   on GitHub, "Add file -> Upload files" keeps folder structure if you drag
   the whole unzipped folder's CONTENTS in (drag the public folder itself too).
2. Render redeploys. Your DATABASE_URL and data stay untouched.
3. Open your Render URL — the app itself now loads there.
   https://mithmail-ai.onrender.com IS your app now.
4. You can delete the Netlify site; it's obsolete.

## New UI
- Campaigns: progress bar, sent, replied + reply %, per-row start/pause.
- Inboxes: real "X of 30" sent-today counts.
- Unibox: search box.
- No backend-URL field anywhere.
