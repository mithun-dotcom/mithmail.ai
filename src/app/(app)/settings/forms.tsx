"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/form-message";
import { addToBlocklist, createApiKey, createWebhook, inviteMember, saveSendingEngine, syncSalesblinkNow, type Result } from "./actions";

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

export function SendingEngineForm({ engine, hasKey, envKey, canEdit }: { engine: "BUILTIN" | "SALESBLINK"; hasKey: boolean; envKey: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<Result, FormData>(saveSendingEngine, {});
  const [choice, setChoice] = useState(engine);
  const [syncState, setSyncState] = useState<Result>({});
  const [syncing, startSync] = useTransition();
  return (
    <form action={action} className="grid gap-4">
      {/* Hidden field, not the radios: React resets uncontrolled form fields after each submit. */}
      <input type="hidden" name="engine" value={choice} />
      <div className="grid gap-2 sm:grid-cols-2">
        {(["SALESBLINK", "BUILTIN"] as const).map((e) => (
          <label key={e} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${choice === e ? "border-royal-500 bg-royal-50" : ""}`}>
            <input type="radio" value={e} checked={choice === e} onChange={() => setChoice(e)} disabled={!canEdit} className="mt-1" />
            <span>
              <span className="font-medium">{e === "SALESBLINK" ? "SalesBlink" : "Built-in (SMTP/IMAP)"}</span>
              <span className="block text-xs text-muted-foreground">
                {e === "SALESBLINK"
                  ? "SalesBlink sends, warms up and monitors your inboxes. MithMill builds campaigns and shows results."
                  : "MithMill's own workers send over SMTP, warm up and read replies over IMAP."}
              </span>
            </span>
          </label>
        ))}
      </div>
      {choice === "SALESBLINK" && (
        <div className="grid gap-1.5">
          <Input
            name="apiKey"
            type="password"
            autoComplete="off"
            disabled={!canEdit}
            placeholder={hasKey ? "•••••••• saved — enter a new key to replace" : envKey ? "Using the server's SALESBLINK_API_KEY — or enter a workspace key" : "SalesBlink API key"}
          />
          <p className="text-xs text-muted-foreground">Get it at run.salesblink.io → Account → Integration → API. Stored encrypted.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !canEdit}>{pending ? "Verifying…" : "Save engine"}</Button>
        {engine === "SALESBLINK" && (
          <Button type="button" variant="outline" disabled={syncing} onClick={() => startSync(async () => setSyncState(await syncSalesblinkNow()))}>
            Sync now
          </Button>
        )}
        <FormMessage state={state.error || state.message ? state : syncState} />
      </div>
    </form>
  );
}
