# Slice 5 backend — CSV upload fixes

Two fixes for the "Could not parse file: Failed to fetch" error:

1. express.json limit raised to 25mb (default ~100KB rejected any real
   lead list — that was the failure).
2. Lead inserts are now BATCHED: one multi-row INSERT per 500 leads
   instead of one query per lead. 8,650 leads = ~18 queries, seconds.
   Also de-dupes within the upload and reports invalid emails separately.

## Update on Render
Replace ONE file in your GitHub repo: server.js
(db.js and package.json are unchanged from what you have deployed.)
Render auto-redeploys on commit.
