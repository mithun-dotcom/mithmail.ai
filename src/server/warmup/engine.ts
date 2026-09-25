import { randomUUID } from "node:crypto";
import type { EmailAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { domainOf } from "@/lib/utils";
import { generateWarmupEmail, generateWarmupReply } from "@/server/ai";
import { transportFor } from "@/server/mail/pool";
import { getQueue, QUEUES, type WarmupJob } from "@/server/queue";
import { WARMUP_HEADER } from "@/server/inbox/warmup-inbound";
import { startOfUtcDay } from "@/server/sending/scheduler";

const PLAN_EVERY_MIN = 15;
const ACTIVE_HOURS_UTC = { start: 7, end: 21 }; // warm-up traffic spread across the working day

/** Today's warm-up target: ramps up by `warmupRampUp` per day until `warmupDailyLimit`. */
export function dailyWarmupTarget(account: Pick<EmailAccount, "warmupStartedAt" | "warmupRampUp" | "warmupDailyLimit">, now = new Date()) {
  const started = account.warmupStartedAt ?? now;
  const day = Math.floor((startOfUtcDay(now).getTime() - startOfUtcDay(started).getTime()) / 86_400_000) + 1;
  return Math.min(account.warmupDailyLimit, Math.max(1, day * account.warmupRampUp));
}

/**
 * Runs every 15 minutes. For each warm-up inbox, decides whether to send in this slot
 * (probability = remaining today / slots left), and picks a peer from another workspace.
 */
export async function planWarmup(now = new Date()): Promise<number> {
  const hour = now.getUTCHours();
  if (hour < ACTIVE_HOURS_UTC.start || hour >= ACTIVE_HOURS_UTC.end) return 0;
  const slotsLeft = Math.max(1, Math.ceil(((ACTIVE_HOURS_UTC.end - hour) * 60 - now.getUTCMinutes()) / PLAN_EVERY_MIN));

  const pool = await db.emailAccount.findMany({
    where: { isWarmupEnabled: true, status: "ACTIVE" },
    select: { id: true, workspaceId: true, emailAddress: true, warmupStartedAt: true, warmupRampUp: true, warmupDailyLimit: true },
  });
  if (pool.length < 2) return 0;

  const sentToday = await db.warmupLog.groupBy({
    by: ["senderAccountId"],
    where: { sentAt: { gte: startOfUtcDay(now) } },
    _count: true,
  });
  const sent = new Map(sentToday.map((s) => [s.senderAccountId, s._count]));
  const q = getQueue(QUEUES.warmup);
  let planned = 0;

  for (const a of pool) {
    const remaining = dailyWarmupTarget(a, now) - (sent.get(a.id) ?? 0);
    if (remaining <= 0) continue;
    const toSend = Math.floor(remaining / slotsLeft) + (Math.random() < (remaining % slotsLeft) / slotsLeft ? 1 : 0);
    for (let i = 0; i < toSend; i++) {
      // Prefer peers from other workspaces and other domains: that's what builds cross-network reputation.
      const peers = pool.filter((p) => p.id !== a.id && domainOf(p.emailAddress) !== domainOf(a.emailAddress));
      const external = peers.filter((p) => p.workspaceId !== a.workspaceId);
      const choices = external.length ? external : peers;
      if (!choices.length) break;
      const peer = choices[Math.floor(Math.random() * choices.length)];
      await q.add("send", { kind: "send", senderAccountId: a.id, recipientAccountId: peer.id } satisfies WarmupJob, {
        delay: Math.floor(Math.random() * PLAN_EVERY_MIN * 60_000),
        attempts: 2,
        backoff: { type: "fixed", delay: 300_000 },
      });
      planned++;
    }
  }
  return planned;
}

export async function sendWarmupEmail(senderId: string, recipientId: string) {
  const [sender, recipient] = await Promise.all([
    db.emailAccount.findUnique({ where: { id: senderId } }),
    db.emailAccount.findUnique({ where: { id: recipientId } }),
  ]);
  if (!sender || !recipient || !sender.isWarmupEnabled || sender.status !== "ACTIVE") return "skipped";

  const content = await generateWarmupEmail();
  const id = randomUUID();
  const messageId = `<${randomUUID()}@${domainOf(sender.emailAddress)}>`;
  const transport = await transportFor(sender);
  await transport.sendMail({
    from: sender.fromName ? { name: sender.fromName, address: sender.emailAddress } : sender.emailAddress,
    to: recipient.emailAddress,
    subject: content.subject,
    text: content.body,
    messageId,
    headers: { [WARMUP_HEADER]: id },
  });
  await db.warmupLog.create({ data: { id, senderAccountId: sender.id, recipientAccountId: recipient.id, messageId, subject: content.subject } });
  return "sent";
}

export async function sendWarmupReply(replierId: string, warmupLogId: string) {
  const log = await db.warmupLog.findUnique({ where: { id: warmupLogId }, include: { sender: true, recipient: true } });
  if (!log || log.status === "REPLIED" || log.recipientAccountId !== replierId) return "skipped";
  const replier = log.recipient;
  if (replier.status !== "ACTIVE") return "skipped";

  const body = await generateWarmupReply(log.subject);
  const transport = await transportFor(replier);
  await transport.sendMail({
    from: replier.fromName ? { name: replier.fromName, address: replier.emailAddress } : replier.emailAddress,
    to: log.sender.emailAddress,
    subject: /^re:/i.test(log.subject) ? log.subject : `Re: ${log.subject}`,
    text: body,
    messageId: `<${randomUUID()}@${domainOf(replier.emailAddress)}>`,
    inReplyTo: log.messageId,
    references: [log.messageId],
    headers: { [WARMUP_HEADER]: `${log.id}:r` },
  });
  await db.warmupLog.update({ where: { id: log.id }, data: { status: "REPLIED", repliedAt: new Date() } });
  return "replied";
}
