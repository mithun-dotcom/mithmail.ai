"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkNewSalesblinkInbox, salesblinkSenderBaseline } from "../actions";

const POLL_MS = 4_000; // one GET /senders per poll — inside SalesBlink's 30 GET/min
const GIVE_UP_MS = 10 * 60_000;

const NOT_ADDED =
  "SalesBlink didn't add a new inbox. If it said \"exists\", that address is already connected in another SalesBlink workspace — remove it there, then connect it again here.";

/**
 * SalesBlink ignores custom redirect URLs, so after sign-in the provider lands on SalesBlink's
 * own result page. We open sign-in in a popup, watch for the new inbox, then close the popup
 * and bring the user straight to the inbox in MithMill.
 */
export function OAuthConnectButton({ provider, label }: { provider: "google" | "outlook"; label: string }) {
  const router = useRouter();
  const popup = useRef<Window | null>(null);
  const baseline = useRef<string[] | null>(null);
  const done = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState("");

  const stop = useCallback((message: string) => {
    done.current = true;
    popup.current?.close();
    setWaiting(false);
    setChecking(false);
    setNote(message);
  }, []);

  /** One check. Returns true when the inbox was found (and we navigated to it). */
  const check = useCallback(async () => {
    if (!baseline.current) return false;
    const res = await checkNewSalesblinkInbox(baseline.current);
    if (done.current) return true;
    if (res.accountId) {
      done.current = true;
      popup.current?.close();
      router.push(`/accounts?account=${res.accountId}&connected=1`);
      return true;
    }
    if (res.error) setNote(`SalesBlink: ${res.error}`);
    return false;
  }, [router]);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (done.current) return;
      const popupClosed = !!popup.current?.closed;
      if (await check()) return;
      if (done.current) return;
      if (popupClosed) return stop(NOT_ADDED);
      if (Date.now() - started > GIVE_UP_MS) return stop("No new inbox found. If you finished signing in, click Sync from SalesBlink on the Email accounts page.");
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, check, stop]);

  return (
    <div className="grid gap-2">
      <Button
        variant="gold"
        disabled={waiting}
        onClick={() => {
          setNote("");
          done.current = false;
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
      {waiting && (
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">Finish signing in in the popup. It closes by itself once the inbox is connected.</p>
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              // SalesBlink can take a few seconds to register the sender after sign-in.
              for (let i = 0; i < 3; i++) {
                if (await check()) return;
                await new Promise((r) => setTimeout(r, 3_000));
              }
              if (!done.current) stop(NOT_ADDED);
            }}
          >
            {checking ? "Checking…" : "I've finished signing in"}
          </Button>
        </div>
      )}
      {note && <p className="text-xs text-amber-800">{note}</p>}
    </div>
  );
}
