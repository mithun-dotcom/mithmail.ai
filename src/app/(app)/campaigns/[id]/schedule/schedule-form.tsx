"use client";

import { useState, useTransition } from "react";
import { DAY_LABELS, type ScheduleDraft } from "@/lib/campaign-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/form-message";
import { saveSchedule } from "../../actions";

const ZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];

export function ScheduleForm({ campaignId, initial }: { campaignId: string; initial: ScheduleDraft }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ error?: string; message?: string }>({});
  const [pending, start] = useTransition();
  const toggle = (d: number) =>
    setV({ ...v, daysOfWeek: v.daysOfWeek.includes(d) ? v.daysOfWeek.filter((x) => x !== d) : [...v.daysOfWeek, d].sort() });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Sending window</CardTitle>
        <CardDescription>Emails only go out inside this window, in the lead-facing timezone you choose.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-1.5">
          <Label>Timezone</Label>
          <Select value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>
            {(ZONES.includes("UTC") ? ZONES : ["UTC", ...ZONES]).map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Days</Label>
          <div className="flex gap-1.5">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggle(i)}
                className={cn("h-9 w-12 rounded-md border text-sm", v.daysOfWeek.includes(i) ? "border-royal-600 bg-royal-600 text-white" : "bg-white")}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-4">
          <div className="grid gap-1.5">
            <Label>From</Label>
            <Input type="time" value={v.startTime} onChange={(e) => setV({ ...v, startTime: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>To</Label>
            <Input type="time" value={v.endTime} onChange={(e) => setV({ ...v, endTime: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={() => start(async () => setMsg(await saveSchedule(campaignId, v)))}>
            {pending ? "Saving…" : "Save schedule"}
          </Button>
          <FormMessage state={msg} />
        </div>
      </CardContent>
    </Card>
  );
}
