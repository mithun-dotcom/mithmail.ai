"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/form-message";
import {
  addToBlocklist,
  createApiKey,
  createSalesblinkWorkspaceAction,
  createWebhook,
  inviteMember,
  linkSalesblinkKeyAction,
  savePlatformKeyAction,
  syncSalesblinkNow,
  unlinkSalesblinkAction,
  useMainSalesblinkWorkspaceAction,
  type Result,
} from "./actions";

function Secret({ state }: { state: Result }) {
  if (!state.secret) return <FormMessage state={state} />;
  return (
    <div className="rounded-md border border-gold-300 bg-gold-100 p-3 text-sm">
      <p className="mb-1 text-amber-900">{state.message}</p>
      <code className="block break-all rounded bg-white px-2 py-1 text-xs">{state.secret}</code>
    </div>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState<Result, FormData>(inviteMember, {});
  return (
    <form action={action} className="grid gap-2">
      <div className="flex gap-2">
        <Input name="email" type="email" placeholder="teammate@company.com" required />
        <Select name="role" className="w-32" defaultValue="VIEWER">
          <option value="ADMIN">Admin</option>
          <option value="VIEWER">Viewer</option>
        </Select>
        <Button disabled={pending}>Invite</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function BlocklistForm() {
  const [state, action, pending] = useActionState<Result, FormData>(addToBlocklist, {});
  return (
    <form action={action} className="grid gap-2">
      <Textarea name="entries" rows={3} placeholder={"competitor.com\nceo@bigcorp.com"} />
      <div className="flex items-center gap-3">
        <Button disabled={pending} variant="outline">Add to blocklist</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function ApiKeyForm() {
  const [state, action, pending] = useActionState<Result, FormData>(createApiKey, {});
  return (
    <form action={action} className="grid gap-2">
      <div className="flex gap-2">
        <Input name="name" placeholder="Zapier, CRM sync…" required />
        <Button disabled={pending}>Create key</Button>
      </div>
      <Secret state={state} />
    </form>
  );
}

export function WebhookForm({ events }: { events: readonly string[] }) {
  const [state, action, pending] = useActionState<Result, FormData>(createWebhook, {});
  return (
    <form action={action} className="grid gap-3">
      <Input name="url" type="url" placeholder="https://hooks.yourcrm.com/mithmill" required />
      <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
        {events.map((e) => (
          <label key={e} className="flex items-center gap-2">
            <input type="checkbox" name="events" value={e} defaultChecked={e.startsWith("lead.")} /> <code className="text-xs">{e}</code>
          </label>
        ))}
      </div>
      <Button disabled={pending} className="justify-self-start">Add webhook</Button>
      <Secret state={state} />
    </form>
  );
}

type LinkState = "no-platform-key" | "not-created" | "awaiting-key" | "linked";

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-600 text-white" : "bg-royal-100 text-royal-800"}`}>
        {done ? "✓" : n}
      </span>
      <div className="grid flex-1 gap-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function SalesblinkPanel({
  state,
  sbWorkspaceName,
  isOwner,
  isSuperAdmin,
}: {
  state: LinkState;
  sbWorkspaceName: string | null;
  isOwner: boolean;
  isSuperAdmin: boolean;
}) {
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  // Plain transitions (not <form action>): these forms disappear when the step completes,
  // and a form action whose form unmounts mid-flight never applies the server's re-render.
  const [linkState, setLinkState] = useState<Result>({});
  const [platformState, setPlatformState] = useState<Result>({});
  const run = (fn: () => Promise<Result>) => start(async () => setMsg(await fn()));
  const submit = (fn: (s: Result, fd: FormData) => Promise<Result>, set: (r: Result) => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => set(await fn({}, fd)));
  };

  if (state === "linked") {
    return (
      <div className="grid gap-3">
        <p className="text-sm">
          ✅ Linked to SalesBlink workspace <b>{sbWorkspaceName ?? "—"}</b>. Inboxes you connect here are added to it; campaigns, warm-up and replies run there.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(syncSalesblinkNow)}>Sync now</Button>
          {isOwner && (
            <Button variant="ghost" disabled={pending} onClick={() => confirm("Unlink SalesBlink? New campaigns will use the built-in engine.") && run(unlinkSalesblinkAction)}>
              Unlink
            </Button>
          )}
          <FormMessage state={msg} />
        </div>
      </div>
    );
  }

  if (state === "no-platform-key") {
    return isSuperAdmin ? (
      <form onSubmit={submit(savePlatformKeyAction, setPlatformState)} className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          Paste your <b>main SalesBlink API key</b> (the account owner&apos;s, from run.salesblink.io → Account → Integration → API). MithMill uses it only to create one SalesBlink workspace per MithMill workspace.
        </p>
        <div className="flex gap-2">
          <Input name="ownerKey" type="password" autoComplete="off" placeholder="SalesBlink owner API key" />
          <Button disabled={pending}>{pending ? "Verifying…" : "Save"}</Button>
        </div>
        <FormMessage state={platformState} />
      </form>
    ) : (
      <p className="text-sm text-muted-foreground">SalesBlink isn&apos;t set up on this platform yet. Ask the platform admin to add the SalesBlink owner key.</p>
    );
  }

  return (
    <div className="grid gap-4">
      <Step n={1} title="Create this workspace's SalesBlink workspace" done={state === "awaiting-key"}>
        {state === "not-created" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!isOwner || pending} onClick={() => run(createSalesblinkWorkspaceAction)}>Create SalesBlink workspace</Button>
            <Button variant="ghost" disabled={!isOwner || pending} onClick={() => run(useMainSalesblinkWorkspaceAction)}>
              Or use my main SalesBlink workspace
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Created: <b>{sbWorkspaceName}</b></p>
        )}
      </Step>
      <Step n={2} title="Create an API key inside it (one time — SalesBlink only allows this in its dashboard)">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Open{" "}
            <a href="/api/salesblink/keys-link" target="_blank" rel="noopener" className="font-medium text-primary underline">
              SalesBlink → API keys ↗
            </a>
          </li>
          <li>
            Switch to the workspace <b>{sbWorkspaceName ?? "for this client"}</b> (workspace menu, top left in SalesBlink).
          </li>
          <li>Create a new API key and copy it.</li>
        </ol>
      </Step>
      <Step n={3} title="Paste the key to link">
        <form onSubmit={submit(linkSalesblinkKeyAction, setLinkState)} className="flex gap-2">
          <Input name="apiKey" type="password" autoComplete="off" placeholder="API key from that SalesBlink workspace" disabled={!isOwner} />
          <Button disabled={!isOwner || pending}>{pending ? "Checking…" : "Link"}</Button>
        </form>
        <FormMessage state={linkState} />
      </Step>
      <FormMessage state={msg} />
    </div>
  );
}
