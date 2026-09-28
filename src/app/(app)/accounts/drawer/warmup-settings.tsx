"use client";

import { useState, useTransition } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/form-message";
import { updateWarmupSettings, type ActionState } from "../actions";
import type { AccountView } from "./types";
import { Field, Section, Switch } from "./ui";

const WORDS = ["amber", "birch", "cedar", "delta", "ember", "fable", "grove", "harbor", "island", "juniper", "kestrel", "lumen", "maple", "north", "orchid", "pine", "quartz", "river", "saving", "timber", "umber", "vista", "window", "willow", "zephyr"];

function randomTag() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a}-${b}`;
}

export function WarmupSettings({ account }: { account: AccountView }) {
  // Plain transition (not <form action>): React 19 resets forms after an action, which un-ticks controlled switches.
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => setState(await updateWarmupSettings(account.id, {}, fd)));
  };
  const [enabled, setEnabled] = useState(account.isWarmupEnabled);
  const [tag, setTag] = useState(account.warmupTag ?? "");

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <Switch name="isWarmupEnabled" checked={enabled} onChange={setEnabled} label="Warmup" />

      <p className="rounded-xl border border-royal-100 bg-royal-50/70 p-4 text-sm leading-relaxed text-royal-900">
        Warm-up sends and replies to real conversations across the warm-up network, rescues them from spam and marks them important, so your
        inbox builds a sending reputation before and during campaigns.
        {account.salesblinkSenderId && " These settings are applied to this inbox in SalesBlink."}
      </p>

      <Section title="Basic warmup settings">
        <Field label="Warmup filter tag" hint="A unique string included in all warm-up emails so you can filter them out of your inbox.">
          <div className="flex items-center gap-2">
            <Input name="warmupTag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. saving-window" />
            <Button type="button" variant="outline" size="icon" title="Generate" onClick={() => setTag(randomTag())}>
              <RefreshCw />
            </Button>
            <Button type="button" variant="outline" size="icon" title="Copy" disabled={!tag} onClick={() => navigator.clipboard?.writeText(tag)}>
              <Copy />
            </Button>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Daily warmup limit" hint="Max 50 emails.">
            <Input name="warmupDailyLimit" type="number" min={1} max={50} defaultValue={Math.min(50, account.warmupDailyLimit)} />
          </Field>
          <Field label="Daily ramp-up" hint="Extra warm-up emails per day until the limit.">
            <Input name="warmupRampUp" type="number" min={1} max={20} defaultValue={account.warmupRampUp} />
          </Field>
          <Field label="Reply rate %" hint="Share of warm-ups that get a reply.">
            <Input name="warmupReplyRate" type="number" min={0} max={100} defaultValue={account.warmupReplyRate} />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t bg-white/95 px-6 py-3 backdrop-blur">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save warmup settings"}</Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
