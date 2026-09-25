"use client";

import { useActionState } from "react";
import type { EmailAccount, TrackingDomain } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/form-message";
import { updateAccount, type ActionState } from "../actions";

export function SettingsForm({
  account,
  trackingDomains,
  dkimSelector,
}: {
  account: EmailAccount;
  trackingDomains: TrackingDomain[];
  dkimSelector: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateAccount.bind(null, account.id), {});

  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>From name</Label>
          <Input name="fromName" defaultValue={account.fromName ?? ""} />
        </div>
        <div className="grid gap-1.5">
          <Label>Custom tracking domain</Label>
          <Select name="trackingDomainId" defaultValue={account.trackingDomainId ?? ""}>
            <option value="">Default (shared)</option>
            {trackingDomains.map((d) => (
              <option key={d.id} value={d.id} disabled={!d.cnameVerified}>
                {d.domainName} {d.cnameVerified ? "" : "(unverified)"}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>Daily campaign limit</Label>
          <Input name="dailyLimit" type="number" min={1} max={500} defaultValue={account.dailyLimit} />
        </div>
        <div className="grid gap-1.5">
          <Label>Min gap between sends (s)</Label>
          <Input name="minDelaySeconds" type="number" min={0} defaultValue={account.minDelaySeconds} />
        </div>
        <div className="grid gap-1.5">
          <Label>Max gap between sends (s)</Label>
          <Input name="maxDelaySeconds" type="number" min={0} defaultValue={account.maxDelaySeconds} />
        </div>
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium text-royal-800">Warm-up</legend>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" name="isWarmupEnabled" defaultChecked={account.isWarmupEnabled} /> Enable warm-up for this inbox
        </label>
        <div className="grid gap-1.5">
          <Label>Warm-up emails / day (max)</Label>
          <Input name="warmupDailyLimit" type="number" min={1} max={100} defaultValue={account.warmupDailyLimit} />
        </div>
        <div className="grid gap-1.5">
          <Label>Daily ramp-up</Label>
          <Input name="warmupRampUp" type="number" min={1} max={20} defaultValue={account.warmupRampUp} />
        </div>
        <div className="grid gap-1.5">
          <Label>Reply rate %</Label>
          <Input name="warmupReplyRate" type="number" min={0} max={100} defaultValue={account.warmupReplyRate} />
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label>Signature (HTML allowed)</Label>
        <Textarea name="signature" rows={4} defaultValue={account.signature ?? ""} />
      </div>
      <div className="grid gap-1.5 sm:w-1/3">
        <Label>DKIM selector (optional)</Label>
        <Input name="dkimSelector" defaultValue={dkimSelector ?? ""} placeholder="auto-detect" />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
