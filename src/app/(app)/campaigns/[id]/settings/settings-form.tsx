"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/form-message";
import { StatusBadge } from "@/components/status-badge";
import { saveOptions, setSubsequence } from "../../actions";

interface Options {
  trackOpens: boolean;
  trackClicks: boolean;
  stopOnReply: boolean;
  espMatching: boolean;
  includeUnsubscribe: boolean;
  sendAsPlainText: boolean;
  dailyLeadLimit: number | null;
  emailAccountIds: string[];
}
type Account = { id: string; emailAddress: string; provider: string; status: string; dailyLimit: number };

const TOGGLES: { key: keyof Options; label: string; hint: string }[] = [
  { key: "stopOnReply", label: "Stop on reply", hint: "Pause the lead's sequence as soon as they reply." },
  { key: "espMatching", label: "ESP matching", hint: "Send Gmail leads from Google inboxes and Outlook leads from Microsoft inboxes when possible." },
  { key: "trackOpens", label: "Track opens", hint: "Adds an invisible pixel. Disable for maximum deliverability." },
  { key: "trackClicks", label: "Track clicks", hint: "Rewrites links through your tracking domain." },
  { key: "includeUnsubscribe", label: "Unsubscribe link", hint: "Adds a one-click unsubscribe link and List-Unsubscribe header." },
  { key: "sendAsPlainText", label: "Plain text only", hint: "No HTML part — disables open and click tracking." },
];

export function SettingsForm({
  campaignId,
  accounts,
  campaigns,
  initial,
  subsequence,
}: {
  campaignId: string;
  accounts: Account[];
  campaigns: { id: string; name: string }[];
  initial: Options;
  subsequence: { parentCampaignId: string | null; triggerLabel: string | null };
}) {
  const [v, setV] = useState(initial);
  const [sub, setSub] = useState(subsequence);
  const [msg, setMsg] = useState<{ error?: string; message?: string }>({});
  const [subMsg, setSubMsg] = useState<{ error?: string; message?: string }>({});
  const [pending, start] = useTransition();
  const selected = new Set(v.emailAccountIds);
  const capacity = accounts.filter((a) => selected.has(a.id) && a.status === "ACTIVE").reduce((n, a) => n + a.dailyLimit, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Sending inboxes</CardTitle>
          <CardDescription>
            {selected.size} selected · up to {capacity.toLocaleString()} emails/day. Sends rotate across all selected inboxes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex gap-2 text-xs">
            <button className="text-primary" onClick={() => setV({ ...v, emailAccountIds: accounts.map((a) => a.id) })}>Select all</button>
            <button className="text-muted-foreground" onClick={() => setV({ ...v, emailAccountIds: [] })}>Clear</button>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-md border">
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={(e) =>
                    setV({ ...v, emailAccountIds: e.target.checked ? [...v.emailAccountIds, a.id] : v.emailAccountIds.filter((x) => x !== a.id) })
                  }
                />
                <span className="flex-1 truncate">{a.emailAddress}</span>
                <span className="text-xs text-muted-foreground">{a.provider.toLowerCase()} · {a.dailyLimit}/day</span>
                {a.status !== "ACTIVE" && <StatusBadge status={a.status} />}
              </label>
            ))}
            {accounts.length === 0 && <p className="p-4 text-sm text-muted-foreground">No inboxes connected yet.</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Options</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {TOGGLES.map((t) => (
              <label key={t.key} className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={v[t.key] as boolean} onChange={(e) => setV({ ...v, [t.key]: e.target.checked })} />
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </span>
              </label>
            ))}
            <div className="grid gap-1.5">
              <Label>Max new leads per day</Label>
              <Input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={v.dailyLeadLimit ?? ""}
                onChange={(e) => setV({ ...v, dailyLeadLimit: e.target.value ? Number(e.target.value) : null })}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={pending} onClick={() => start(async () => setMsg(await saveOptions(campaignId, v)))}>Save settings</Button>
              <FormMessage state={msg} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subsequence</CardTitle>
            <CardDescription>Make this campaign a follow-up track: leads enter it automatically when their reply to another campaign gets a label.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Parent campaign</Label>
              <Select value={sub.parentCampaignId ?? ""} onChange={(e) => setSub({ ...sub, parentCampaignId: e.target.value || null })}>
                <option value="">— not a subsequence —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>When a reply is labelled</Label>
              <Select value={sub.triggerLabel ?? "INTERESTED"} onChange={(e) => setSub({ ...sub, triggerLabel: e.target.value })} disabled={!sub.parentCampaignId}>
                {["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "NEUTRAL"].map((l) => (
                  <option key={l} value={l}>{l.toLowerCase().replace(/_/g, " ")}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => start(async () => setSubMsg(await setSubsequence(campaignId, sub.parentCampaignId, sub.parentCampaignId ? sub.triggerLabel ?? "INTERESTED" : null)))}
              >
                Save subsequence
              </Button>
              <FormMessage state={subMsg} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
