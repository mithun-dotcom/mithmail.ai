# Coldwave — queue-stranding bug FIXED

## The bug your Diagnose screenshot found
Pressing Start stamps each queued email with the inbox IDs selected AT THAT
MOMENT. If you later change the inbox selection in Options, the queue still
points at the old inboxes — the engine looks for work assigned to the CURRENT
inboxes, finds none, and sits idle forever. Every other check passes, so it
looks perfectly healthy while doing nothing. That was my bug, not your setup.

## Three fixes
1. repairQueue() in engine.js — re-points every pending email (and every
   lead's sticky inbox) at the inboxes currently selected.
2. Saving Options now runs repair automatically, so changing inboxes can
   never strand the queue again.
3. planCampaign clears sticky inboxes that are no longer selected, and runs
   a repair pass at the end of every Start.
Plus a manual "Repair queue" button in the Diagnose panel.

## Deploy — 3 files
  engine.js       (replaced)
  server.js       (replaced)
  public/app.js   (replaced)
Others unchanged.

## Then, to get your 4 emails moving
1. Open the campaign -> 🩺 Diagnose -> "Repair queue".
2. Re-run Diagnose. Everything should be ✓ and the verdict should read
   "All checks pass".
3. Wait ~45 seconds. The first email sends. The rest follow over the next
   10-40 minutes because of the deliberate 3-12 minute randomized gap per
   inbox (that pacing is what keeps you out of spam folders).
