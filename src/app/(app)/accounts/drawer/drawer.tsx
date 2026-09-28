"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AtSign, ChevronLeft, ChevronRight, Flame, Inbox, MailCheck, MailX, MessageSquareReply, Send, ShieldCheck, ThumbsUp, UserCheck, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import type { SendingStats, WarmupStats } from "@/server/services/account-stats";
import { DailySentChart, WarmupChart } from "./charts";
import { Tile } from "./ui";

type Tab = "account" | "warmup";
type View = "analytics" | "settings";

export interface DrawerProps {
  account: { id: string; emailAddress: string; provider: string; status: string; lastError: string | null; healthScore: number | null; salesblinkSenderId: string | null; isWarmupEnabled: boolean };
  prevId: string | null;
  nextId: string | null;
  range: string;
  ranges: Record<string, string>;
  connected: boolean;
  sending: SendingStats;
  warmup: WarmupStats;
  accountSettings: React.ReactNode;
  warmupSettings: React.ReactNode;
  accountExtras: React.ReactNode;
}

export function ProviderMark({ provider, className }: { provider: string; className?: string }) {
  if (provider === "GOOGLE")
    return <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-[#4285f4] ring-1 ring-slate-200", className)}>G</span>;
  if (provider === "MICROSOFT")
    return <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-[#0078d4] ring-1 ring-slate-200", className)}>M</span>;
  return (
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200", className)}>
      <AtSign className="h-3.5 w-3.5" />
    </span>
  );
}

export function AccountDrawer(p: DrawerProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "warmup" ? "warmup" : "account");
  const [view, setView] = useState<View>(params.get("view") === "settings" ? "settings" : "analytics");

  const href = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      q.delete("connected");
      q.set("tab", tab);
      q.set("view", view);
      for (const [k, v] of Object.entries(patch)) (v === null ? q.delete(k) : q.set(k, v));
      return `/accounts?${q.toString()}`;
    },
    [params, tab, view],
  );
  const closeHref = href({ account: null, tab: null, view: null, range: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
      if (e.key === "ArrowLeft" && p.prevId) router.push(href({ account: p.prevId }), { scroll: false });
      if (e.key === "ArrowRight" && p.nextId) router.push(href({ account: p.nextId }), { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref, href, p.prevId, p.nextId]);

  const s = p.sending;
  const w = p.warmup;

  return (
    <div className="fixed inset-0 z-50">
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 animate-fade-in bg-slate-900/40" />
      <aside
        role="dialog"
        aria-label={p.account.emailAddress}
        className="absolute right-0 top-0 flex h-full w-full max-w-[1000px] animate-slide-in-right flex-col bg-slate-50 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b bg-white px-4 py-3 sm:px-6">
          <NavButton href={p.prevId ? href({ account: p.prevId }) : null} label="Previous inbox">
            <ChevronLeft className="h-4 w-4" />
          </NavButton>
          <NavButton href={p.nextId ? href({ account: p.nextId }) : null} label="Next inbox">
            <ChevronRight className="h-4 w-4" />
          </NavButton>
          <ProviderMark provider={p.account.provider} className="ml-1" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-royal-950">{p.account.emailAddress}</p>
          </div>
          <StatusBadge status={p.account.status} />
          {p.account.healthScore !== null && (
            <Badge variant={p.account.healthScore >= 80 ? "success" : p.account.healthScore >= 60 ? "warning" : "danger"} className="hidden sm:inline-flex">
              Health {p.account.healthScore}
            </Badge>
          )}
          <Link href={closeHref} scroll={false} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-0 pt-4 sm:px-6">
          {p.connected && (
            <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✅ Connected! {p.account.emailAddress} is ready{p.account.salesblinkSenderId ? " in this workspace and SalesBlink" : ""}.
            </p>
          )}
          {p.account.lastError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{p.account.lastError}</p>}

          <nav className="flex gap-6 border-b">
            {(["account", "warmup"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium capitalize",
                  tab === t ? "border-royal-600 text-royal-700" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="my-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg bg-royal-50 p-1">
              {(["analytics", "settings"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn("rounded-md px-4 py-1.5 text-sm font-medium capitalize", view === v ? "bg-white text-royal-900 shadow-sm" : "text-royal-800/70 hover:text-royal-900")}
                >
                  {v}
                </button>
              ))}
            </div>
            {view === "analytics" && (
              <select
                aria-label="Date range"
                value={p.range}
                onChange={(e) => router.replace(href({ range: e.target.value }), { scroll: false })}
                className="h-9 rounded-md border bg-white px-3 text-sm shadow-sm"
              >
                {Object.entries(p.ranges).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="pb-6">
            {tab === "account" && view === "analytics" && (
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Tile icon={<Send className="h-4 w-4" />} label="Total email sent" value={s.sent} />
                  <Tile icon={<Users className="h-4 w-4" />} label="Total contacted leads" value={s.contacted} />
                  <Tile icon={<UserPlus className="h-4 w-4" />} label="New leads contacted" value={s.newLeads} />
                  <Tile icon={<UserCheck className="h-4 w-4" />} label="Total completed leads" value={s.completed} />
                  <Tile icon={<MessageSquareReply className="h-4 w-4" />} label="Reply rate (with OOO)" value={`${s.replyRateWithOoo}%`} count={s.replied} />
                  <Tile icon={<MessageSquareReply className="h-4 w-4" />} label="Reply rate" value={`${s.replyRate}%`} count={s.repliedExOoo} />
                  <Tile icon={<ThumbsUp className="h-4 w-4" />} label="Positive reply" value={`${s.positiveRate}%`} count={s.positive} />
                  <Tile icon={<MailX className="h-4 w-4" />} label="Recipient bounce rate" value={`${s.bounceRate}%`} count={s.bounced} />
                </div>
                <section className="rounded-xl border bg-white p-5 shadow-sm">
                  <h3 className="mb-2 text-base font-semibold text-royal-950">Daily email sent</h3>
                  <DailySentChart data={s.daily} />
                </section>
                {p.accountExtras}
              </div>
            )}
            {tab === "account" && view === "settings" && p.accountSettings}

            {tab === "warmup" && view === "analytics" && (
              <div className="grid gap-4">
                {!p.account.isWarmupEnabled && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Warm-up is off for this inbox.{" "}
                    <button type="button" className="font-medium underline" onClick={() => setView("settings")}>
                      Turn it on
                    </button>
                  </p>
                )}
                {w.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Couldn&apos;t load warm-up stats from SalesBlink: {w.error}</p>}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Tile icon={<Flame className="h-4 w-4" />} label="Warm-up emails sent" value={w.sent} />
                  <Tile icon={<Inbox className="h-4 w-4" />} label="Warm-up emails received" value={w.received} />
                  <Tile icon={<ShieldCheck className="h-4 w-4" />} label="Landed in inbox" value={w.inboxRate === null ? "—" : `${w.inboxRate}%`} />
                  <Tile icon={<MailCheck className="h-4 w-4" />} label="Saved from spam" value={w.savedFromSpam} count={w.replied} hint={`${w.replied} replies received`} />
                </div>
                <section className="rounded-xl border bg-white p-5 shadow-sm">
                  <h3 className="mb-2 text-base font-semibold text-royal-950">Daily warm-up</h3>
                  <WarmupChart data={w.daily} />
                  <p className="mt-2 text-xs text-muted-foreground">Source: {w.source === "salesblink" ? "SalesBlink warm-up network" : "MithMill warm-up network"}.</p>
                </section>
              </div>
            )}
            {tab === "warmup" && view === "settings" && p.warmupSettings}
          </div>
        </div>
      </aside>
    </div>
  );
}

function NavButton({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "flex h-8 w-8 items-center justify-center rounded-full border";
  if (!href)
    return (
      <span aria-disabled className={cn(cls, "text-slate-300")}>
        {children}
      </span>
    );
  return (
    <Link href={href} scroll={false} aria-label={label} className={cn(cls, "border-royal-300 text-royal-700 hover:bg-royal-50")}>
      {children}
    </Link>
  );
}
