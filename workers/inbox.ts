import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { getQueue, QUEUES, redisConnection, type FetchRepliesJob, type WarmupJob } from "@/server/queue";
import { syncInbox } from "@/server/inbox/imap-sync";
import { planWarmup, sendWarmupEmail, sendWarmupReply } from "@/server/warmup/engine";
import { logger } from "./logger";

/** Fans out one fetch job per IMAP-capable inbox. jobId de-duplicates overlapping runs. */
export async function enqueueInboxSyncs() {
  const accounts = await db.emailAccount.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, OR: [{ imapHost: { not: null } }, { provider: { in: ["GOOGLE", "MICROSOFT"] } }] },
    select: { id: true },
  });
  const slot = Math.floor(Date.now() / 300_000);
  await getQueue(QUEUES.fetchReplies).addBulk(
    accounts.map((a) => ({ name: "sync", data: { emailAccountId: a.id } satisfies FetchRepliesJob, opts: { jobId: `sync-${a.id}-${slot}`, attempts: 1 } })),
  );
  return accounts.length;
}

export function startFetchRepliesWorker() {
  return new Worker<FetchRepliesJob | { fanout: true }>(
    QUEUES.fetchReplies,
    async (job) => {
      if ("fanout" in job.data) return { enqueued: await enqueueInboxSyncs() };
      const account = await db.emailAccount.findUnique({ where: { id: job.data.emailAccountId } });
      if (!account) return { skipped: true };
      try {
        const res = await syncInbox(account);
        if (account.lastError?.startsWith("IMAP")) await db.emailAccount.update({ where: { id: account.id }, data: { lastError: null } });
        if (res.replies || res.bounces || res.warmups || res.rescued) logger.info("inbox sync", { inbox: account.emailAddress, ...res });
        return res;
      } catch (e) {
        await db.emailAccount.update({ where: { id: account.id }, data: { lastError: `IMAP: ${(e as Error).message}` } });
        throw e;
      }
    },
    { connection: redisConnection(), concurrency: Number(process.env.IMAP_CONCURRENCY ?? 10) },
  );
}

export function startWarmupWorker() {
  return new Worker<WarmupJob | { plan: true }>(
    QUEUES.warmup,
    async (job) => {
      if ("plan" in job.data) return { planned: await planWarmup() };
      const d = job.data;
      if (d.kind === "send" && d.recipientAccountId) return sendWarmupEmail(d.senderAccountId, d.recipientAccountId);
      if (d.kind === "reply" && d.warmupLogId) return sendWarmupReply(d.senderAccountId, d.warmupLogId);
      return "ignored";
    },
    { connection: redisConnection(), concurrency: 5 },
  );
}
