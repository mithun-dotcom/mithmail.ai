# Slice 1 — Send one email (deploy straight to Render, no local setup)

You don't need to install anything on your Mac. Everything here is done in
the browser: upload code to GitHub's website, deploy on Render, test by
visiting a URL and clicking a button.

Goal: your backend, running live on Render, sends one email.

---

## Step 1 — Get a Gmail App Password
You can't use your normal password. Google requires an "App Password":
  1. Turn on 2-Step Verification on your Google account first (required).
  2. Go to https://myaccount.google.com/apppasswords
  3. Create one, name it "coldemail". Google gives a 16-character code. Copy it.
     (Remove any spaces — it should be 16 letters with nothing between them.)

Keep this code somewhere safe for Step 3.

---

## Step 2 — Put the code on GitHub (all in the browser)
1. Go to https://github.com and sign up / log in.
2. Click the "+" (top right) -> "New repository".
3. Name it `coldemail-slice1`. Keep it Public or Private. Click "Create repository".
4. On the next page, click the link "uploading an existing file".
5. Drag these files from the unzipped folder into the browser:
      - server.js
      - package.json
      - .gitignore
      - .env.example
   (Do NOT create or upload a .env file. Secrets go into Render directly.)
6. Click "Commit changes".

Your code now lives on GitHub. That's the source Render will pull from.

---

## Step 3 — Deploy on Render
1. Go to https://render.com and sign up with your GitHub account.
2. Click "New" -> "Web Service".
3. Connect and pick your `coldemail-slice1` repo.
4. Fill in:
   - Name: anything (e.g. coldemail-slice1)
   - Runtime / Language: Node
   - Build Command: npm install
   - Start Command: npm start
   - Instance Type: Free
5. Scroll to "Environment Variables" and add these four
   (click "Add Environment Variable" for each):

      SMTP_HOST   =  smtp.gmail.com
      SMTP_PORT   =  587
      SMTP_USER   =  youremail@gmail.com
      SMTP_PASS   =  your16charapppassword

   (Type them in here — never put them in a file on GitHub.)
6. Click "Create Web Service" and wait for the build to finish
   (you'll see logs; when it says "Live" it's ready).

---

## Step 4 — Test it
1. Render shows a URL like https://coldemail-slice1.onrender.com
2. Open that URL in your browser. You'll see a "Send a test email" page.
3. Type your own email address, click "Send test email".
4. Check your inbox — the "It works!" email should arrive.

NOTE: On Render's free tier the service "sleeps" after ~15 min of no use.
The first visit after sleeping takes 30-60 seconds to wake up. That's normal.
If the page is slow to load the first time, just wait — it's not broken.

---

## If it fails
The test page shows the exact error. Most common causes:
  - SMTP_USER or SMTP_PASS typed wrong in Render's env vars -> fix and it
    auto-redeploys.
  - App Password has spaces in it -> remove them.
  - Used your normal Gmail password instead of an App Password -> won't work,
    use the App Password.

Copy the error text to me and I'll tell you exactly what to change.

---

## What this proves
When that email arrives, your pipeline works end to end:
  GitHub (code) -> Render (running backend) -> live email sent.
Every later feature — database, campaigns, sending queue, reply detection,
OAuth — is added on top of this exact setup, one slice at a time.

Netlify (the frontend) comes in a later slice, once we have a UI to put there.
For now the backend serves its own test page, so there's nothing to deploy
to Netlify yet.
