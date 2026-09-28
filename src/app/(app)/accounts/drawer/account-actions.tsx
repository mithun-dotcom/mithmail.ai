"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/form-message";
import { deleteAccount, recheckDns, setAccountStatus, testAccount, type ActionState } from "../actions";

export function AccountActions({ id, status }: { id: string; status: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionState | void>) => start(async () => setState((await fn()) ?? {}));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => testAccount(id))}>Test connection</Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => recheckDns(id))}>Re-check DNS</Button>
        {status === "PAUSED" ? (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setAccountStatus(id, "ACTIVE"))}>Resume</Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => setAccountStatus(id, "PAUSED"))}>Pause</Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (confirm("Remove this inbox? Its sending history is deleted too.")) run(() => deleteAccount(id));
          }}
        >
          Remove
        </Button>
      </div>
      <FormMessage state={state} />
    </div>
  );
}
