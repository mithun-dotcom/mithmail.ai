/**
 * Per-inbox analytics for the Email accounts drawer: campaign sending (from EmailLog) and
 * warm-up (from SalesBlink's warm-up stats for SalesBlink inboxes, WarmupLog otherwise).
 */
import type { EmailAccount } from "@prisma/client";
import { startOfDay, subDays } from "date-fns";
import { db } from "@/lib/db";
import { pct } from "@/lib/utils";
import { redis } from "@/server/queue";
import { clientFor } from "@/server/salesblink/service";

export const RANGES = { "7": "Last 7 days", "14": "Last 2 weeks", "30": "Last 30 days", "90": "Last 90 days" } as const;
export type RangeKey = keyof typeof RANGES;
export const parseRange = (v: string | undefined): RangeKey => (v && v in RANGES ? (v as RangeKey) : "14");

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function emptyDays<T>(days: number, make: () => T): Map<string, T> {
  const out = new Map<string, T>();
  const start = subDays(startOfDay(new Date()), days - 1);
  for (let i = 0; i < days; i++) out.set(dayKey(new Date(start.getTime() + i * 86_400_000)), make());
  return out;
}

export interface SendingStats {
  sent: number;
  contacted: number;
  newLeads: number;
  completed: number;
  replied: number;
  repliedExOoo: number;
  positive: number;
  bounced: number;
  replyRateWithOoo: number;
  replyRate: number;
  positiveRate: number;
  bounceRate: number;
  daily: { date: string; newLead: number; followUp: number }[];
}

export async function accountSendingStats(accountId: string, days: number): Promise<SendingStats> {
  const since = subDays(startOfDay(new Date()), days - 1);
  const logs = await db.emailLog.findMany({
    where: { emailAccountId: accountId, sentAt: { gte: since } },
    select: { leadId: true, campaignId: true, sentAt: true, repliedAt: true, status: true, campaignStep: { select: { stepNumber: true } } },
  });
  const daily = emptyDays(days, () => ({ newLead: 0, followUp: 0 }));
  const contacted = new Set<string>();
  const newLeads = new Set<string>();
  const replied = new Set<string>();
  let bounced = 0;
  for (const l of logs) {
    contacted.add(l.leadId);
    const isNew = (l.campaignStep?.stepNumber ?? 1) <= 1;
    if (isNew) newLeads.add(l.leadId);
    const d = daily.get(dayKey(l.sentAt!));
    if (d && isNew) d.newLead++;
    else if (d) d.followUp++;
    if (l.repliedAt) replied.add(`${l.campaignId}:${l.leadId}`);
    if (l.status === "BOUNCED") bounced++;
  }

  const repliedLeadIds = [...new Set([...replied].map((k) => k.split(":")[1]))];
  const [threads, completed] = await Promise.all([
    repliedLeadIds.length
      ? db.thread.findMany({ where: { leadId: { in: repliedLeadIds } }, select: { leadId: true, summaryStatus: true } })
      : Promise.resolve([]),
    db.campaignLead.count({ where: { assignedAccountId: accountId, status: "FINISHED", updatedAt: { gte: since } } }),
  ]);
  const ooo = new Set(threads.filter((t) => t.summaryStatus === "OUT_OF_OFFICE").map((t) => t.leadId));
  const positive = new Set(threads.filter((t) => t.summaryStatus === "INTERESTED" || t.summaryStatus === "MEETING_BOOKED").map((t) => t.leadId));
  const repliedExOoo = repliedLeadIds.filter((id) => !ooo.has(id)).length;

  return {
    sent: logs.length,
    contacted: contacted.size,
    newLeads: newLeads.size,
    completed,
    replied: repliedLeadIds.length,
    repliedExOoo,
    positive: positive.size,
    bounced,
    replyRateWithOoo: pct(repliedLeadIds.length, contacted.size),
    replyRate: pct(repliedExOoo, contacted.size),
    positiveRate: pct(positive.size, contacted.size),
    bounceRate: pct(bounced, logs.length),
    daily: [...daily].map(([date, v]) => ({ date, ...v })),
  };
}

export interface WarmupStats {
  source: "salesblink" | "mithmill";
  sent: number;
  received: number;
  replied: number;
  savedFromSpam: number;
  inboxRate: number | null;
  daily: { date: string; sent: number; received: number; savedFromSpam: number }[];
  error?: string;
}

export async function accountWarmupStats(account: EmailAccount, days: number): Promise<WarmupStats> {
  const daily = emptyDays(days, () => ({ sent: 0, received: 0, savedFromSpam: 0 }));

  if (account.salesblinkSenderId) {
    try {
      const rows = await cachedSbWarmup(account, days);
      let sent = 0, received = 0, replied = 0, saved = 0;
      for (const r of rows) {
        sent += r.sent;
        received += r.received;
        replied += r.sent_replies;
        saved += r.spam_to_inbox;
        const d = daily.get(r.date);
        if (d) Object.assign(d, { sent: r.sent, received: r.received, savedFromSpam: r.spam_to_inbox });
      }
      return { source: "salesblink", sent, received, replied, savedFromSpam: saved, inboxRate: received ? pct(received - saved, received) : null, daily: [...daily].map(([date, v]) => ({ date, ...v })) };
    } catch (e) {
      return { source: "salesblink", sent: 0, received: 0, replied: 0, savedFromSpam: 0, inboxRate: null, daily: [...daily].map(([date, v]) => ({ date, ...v })), error: (e as Error).message };
    }
  }

  const since = subDays(startOfDay(new Date()), days - 1);
  const [out, inbound] = await Promise.all([
    db.warmupLog.findMany({ where: { senderAccountId: account.id, sentAt: { gte: since } }, select: { sentAt: true, repliedAt: true } }),
    db.warmupLog.findMany({ where: { recipientAccountId: account.id, sentAt: { gte: since } }, select: { sentAt: true, landedInSpam: true } }),
  ]);
  for (const l of out) daily.get(dayKey(l.sentAt))!.sent++;
  for (const l of inbound) {
    const d = daily.get(dayKey(l.sentAt))!;
    d.received++;
    if (l.landedInSpam) d.savedFromSpam++;
  }
  const saved = inbound.filter((l) => l.landedInSpam).length;
  return {
    source: "mithmill",
    sent: out.length,
    received: inbound.length,
    replied: out.filter((l) => l.repliedAt).length,
    savedFromSpam: saved,
    inboxRate: inbound.length ? pct(inbound.length - saved, inbound.length) : null,
    daily: [...daily].map(([date, v]) => ({ date, ...v })),
  };
}

/** SalesBlink warm-up stats, cached 15 min per sender to stay inside its rate limits. */
async function cachedSbWarmup(account: EmailAccount, days: number) {
  const key = `sb:warmup-stats:${account.salesblinkSenderId}:${days}`;
  const r = await redis();
  const hit = await r.get(key).catch(() => null);
  if (hit) return JSON.parse(hit) as Awaited<ReturnType<ReturnType<typeof clientFor>["senderWarmupStats"]>>;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: account.workspaceId } });
  const rows = await clientFor(ws).senderWarmupStats(account.salesblinkSenderId!, days);
  await r.set(key, JSON.stringify(rows), "EX", 900).catch(() => undefined);
  return rows;
}
