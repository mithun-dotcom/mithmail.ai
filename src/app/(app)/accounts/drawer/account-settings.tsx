"use client";

import { useState, useTransition } from "react";
import type { TrackingDomain } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/form-message";
import { updateAccountSettings, type ActionState } from "../actions";
import type { AccountView } from "./types";
import { Field, Section, Switch } from "./ui";

function splitName(full: string | null) {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export function AccountSettings({
  account,
  trackingDomains,
  dkimSelector,
}: {
  account: AccountView;
  trackingDomains: Pick<TrackingDomain, "id" | "domainName" | "cnameVerified">[];
  dkimSelector: string | null;
}) {
  // Plain transition (not <form action>): React 19 resets forms after an action, which un-ticks controlled switches.
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => setState(await updateAccountSettings(account.id, {}, fd)));
  };
  const [ramp, setRamp] = useState(account.campaignRampUpEnabled);
  const name = splitName(account.fromName);
  const minutes = (s: number) => Math.round((s / 60) * 10) / 10;

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <Section title="Sender name">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input name="firstName" defaultValue={name.first} />
          </Field>
          <Field label="Last name">
            <Input name="lastName" defaultValue={name.last} />
          </Field>
        </div>
        <Field
          label="Reply to"
          hint="A different Reply-To address isn't fully supported by providers like Google, and replies may not show in the Unibox. Leave empty unless you need it."
        >
          <Input name="replyTo" type="email" defaultValue={account.replyTo ?? ""} placeholder="Optional" />
        </Field>
      </Section>

      <Section title="Delivery settings">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Daily campaign email limit" hint="Check your provider's recommended limit.">
            <Input name="dailyLimit" type="number" min={1} max={500} defaultValue={account.dailyLimit} />
          </Field>
          <Field label="Minimum interval (minutes)" hint="Never sends faster than this.">
            <Input name="minIntervalMinutes" type="number" min={0} max={120} step="any" defaultValue={minutes(account.minDelaySeconds)} />
          </Field>
          <Field label="Maximum interval (minutes)" hint="Gaps are randomised in between.">
            <Input name="maxIntervalMinutes" type="number" min={0} max={240} step="any" defaultValue={minutes(account.maxDelaySeconds)} />
          </Field>
        </div>
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
          <Switch name="campaignRampUpEnabled" checked={ramp} onChange={setRamp} label="Campaign email ramp-up" />
          <p className="text-xs text-muted-foreground">Gradually increase daily campaign sends until the daily limit is reached.</p>
          {ramp && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Initial daily emails limit">
                <Input name="campaignRampUpStart" type="number" min={1} max={500} defaultValue={account.campaignRampUpStart} />
              </Field>
              <Field label="Daily increment in emails">
                <Input name="campaignRampUpIncrement" type="number" min={1} max={100} defaultValue={account.campaignRampUpIncrement} />
              </Field>
            </div>
          )}
          {!ramp && (
            <>
              <input type="hidden" name="campaignRampUpStart" value={account.campaignRampUpStart} />
              <input type="hidden" name="campaignRampUpIncrement" value={account.campaignRampUpIncrement} />
            </>
          )}
        </div>
      </Section>

      <Section title="Signature">
        <Textarea name="signature" rows={4} defaultValue={account.signature ?? ""} placeholder="Best,&#10;Jane" />
      </Section>

      <Section title="Tracking & DNS">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Custom tracking domain">
            <Select name="trackingDomainId" defaultValue={account.trackingDomainId ?? ""}>
              <option value="">Default (shared)</option>
              {trackingDomains.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.cnameVerified}>
                  {d.domainName} {d.cnameVerified ? "" : "(unverified)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="DKIM selector" hint="Leave empty to auto-detect.">
            <Input name="dkimSelector" defaultValue={dkimSelector ?? ""} placeholder="auto-detect" />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t bg-white/95 px-6 py-3 backdrop-blur">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
