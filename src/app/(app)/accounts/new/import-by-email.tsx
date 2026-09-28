"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/form-message";
import { importSalesblinkInbox, type ActionState } from "../actions";

export function ImportByEmail() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await importSalesblinkInbox(email);
          setState(r);
          if (r.accountId) router.push(`/accounts/${r.accountId}?connected=1`);
        });
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? "Looking…" : "Import inbox"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
