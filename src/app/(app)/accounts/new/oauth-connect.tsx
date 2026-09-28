"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkNewSalesblinkInbox, salesblinkSenderBaseline } from "../actions";

const POLL_MS = 6_000; // one GET /senders per poll — well inside SalesBlink's 30 GET/min
const GIVE_UP_MS = 10 * 60_000;

/**
 * SalesBlink ignores custom redirect URLs, so after sign-in the provider lands on SalesBlink's
 * own success page. We open sign-in in a popup, watch for the new inbox, then close the popup
 * and bring the user back to the inbox in MithMill.
 */
export function OAuthConnectButton({ provider, label }: { provider: "google" | "outlook"; label: string }) {
  const router = useRouter();
  const popup = useRef<Window | null>(null);
  const baseline = useRef<string[] | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let stopped = false;
    let closedChecks = 0;
    const tick = async () => {
      if (stopped) return;
      if (!baseline.current) {
        setTimeout(tick, 1000);
        return;
      }
      const res = await checkNewSalesblinkInbox(baseline.current);
      if (stopped) return;
      if (res.accountId) {
        stopped = true;
        popup.current?.close();
        setWaiting(false);
        router.push(`/accounts/${res.accountId}?connected=1`);
        return;
      }
      if (res.error) setNote(`SalesBlink: ${res.error}`);
      // Popup closed without a new inbox: check a couple more times, then stop.
      if (popup.current?.closed) closedChecks++;
      if (closedChecks > 2 || Date.now() - started > GIVE_UP_MS) {
        stopped = true;
        setWaiting(false);
        setNote("No new inbox found yet. If you finished signing in, click Sync from SalesBlink on the Email accounts page in a minute.");
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    const first = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
    };
  }, [waiting, router]);

  return (
    <div className="grid gap-2">
      <Button
        variant="gold"
        disabled={waiting}
        onClick={() => {
          setNote("");
          baseline.current = null;
          // Snapshot existing senders first (the popup must still open synchronously on click).
          void salesblinkSenderBaseline().then((ids) => (baseline.current = ids));
          const w = 520;
          const h = 680;
          const left = window.screenX + (window.outerWidth - w) / 2;
          const top = window.screenY + (window.outerHeight - h) / 2;
          popup.current = window.open(`/api/salesblink/oauth/${provider}`, `mm-oauth-${provider}`, `width=${w},height=${h},left=${left},top=${top}`);
          // Popup blocked → fall back to a normal tab.
          if (!popup.current) popup.current = window.open(`/api/salesblink/oauth/${provider}`, "_blank");
          setWaiting(true);
        }}
      >
        {waiting ? <Loader2 className="animate-spin" /> : null}
        {waiting ? "Waiting for sign-in…" : label}
      </Button>
      {waiting && <p className="text-xs text-muted-foreground">Finish signing in in the popup — this page picks up the inbox automatically and closes it.</p>}
      {note && <p className="text-xs text-amber-800">{note}</p>}
    </div>
  );
}
