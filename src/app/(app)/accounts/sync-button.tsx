"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncSalesblinkAccounts, type ActionState } from "./actions";

export function SalesblinkSyncButton() {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2">
      {(state.message || state.error) && <span className={`text-xs ${state.error ? "text-red-700" : "text-muted-foreground"}`}>{state.error ?? state.message}</span>}
      <Button variant="outline" disabled={pending} onClick={() => start(async () => setState(await syncSalesblinkAccounts()))}>
        <RefreshCw className={pending ? "animate-spin" : ""} /> Sync from SalesBlink
      </Button>
    </span>
  );
}
