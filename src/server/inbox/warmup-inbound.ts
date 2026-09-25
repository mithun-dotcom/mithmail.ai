import type { ImapFlow } from "imapflow";
import type { ParsedMail } from "mailparser";
import type { EmailAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { getQueue, QUEUES, type WarmupJob } from "@/server/queue";

/** Every warm-up email carries this header: "<warmupLogId>" for an original, "<warmupLogId>:r" for a reply. */
export const WARMUP_HEADER = "x-mithmill-warmup";

export function parseWarmupHeader(value: unknown): { logId: string; isReply: boolean } | null {
  const v = String(value ?? "").trim();
  const m = /^([0-9a-f-]{36})(:r)?$/i.exec(v);
  return m ? { logId: m[1], isReply: !!m[2] } : null;
}

/**
 * Recipient-side handling of a warm-up email: mark it read and important, and
 * schedule a human-paced reply (by the account's reply rate).
 */
export async function handleWarmupInbound(client: ImapFlow, account: EmailAccount, mail: ParsedMail, uid: number, folder: string) {
  const tag = parseWarmupHeader(mail.headers.get(WARMUP_HEADER));
  await client.messageFlagsAdd(String(uid), ["\\Seen", "\\Flagged"], { uid: true }).catch(() => undefined);
  if (!tag) return;

  const log = await db.warmupLog.findUnique({ where: { id: tag.logId } });
  if (!log) return;
  if (tag.isReply) return; // replies end the conversation

  // rescueFromSpam() flags the log before moving the message, so the INBOX pass still knows.
  const landedInSpam = log.landedInSpam || folder !== "INBOX";
  if (log.status === "SENT") {
    const delayMs = (1 + Math.random() * 11) * 3600_000; // reply 1-12h later, like a person would
    const willReply = Math.random() * 100 < account.warmupReplyRate;
    await db.warmupLog.update({
      where: { id: log.id },
      data: {
        status: landedInSpam ? "RESCUED_FROM_SPAM" : "LANDED_INBOX",
        landedInSpam,
        replyScheduledAt: willReply ? new Date(Date.now() + delayMs) : null,
      },
    });
    if (willReply) {
      await getQueue(QUEUES.warmup).add(
        "reply",
        { kind: "reply", senderAccountId: account.id, recipientAccountId: log.senderAccountId, warmupLogId: log.id } satisfies WarmupJob,
        { delay: delayMs, attempts: 3, backoff: { type: "exponential", delay: 600_000 }, jobId: `reply-${log.id}` },
      );
    }
  }
}

const SPAM_NAMES = /^(spam|junk|junk e-?mail|\[gmail\]\/spam|bulk mail)$/i;

/** Finds warm-up emails in the spam folder and moves them to the inbox (the core of warm-up). */
export async function rescueFromSpam(client: ImapFlow): Promise<number> {
  const boxes = await client.list();
  const spam = boxes.find((b) => b.specialUse === "\\Junk") ?? boxes.find((b) => SPAM_NAMES.test(b.path) || SPAM_NAMES.test(b.name));
  if (!spam) return 0;

  let rescued = 0;
  const lock = await client.getMailboxLock(spam.path);
  try {
    const uids = (await client.search({ header: { [WARMUP_HEADER]: "" }, since: new Date(Date.now() - 3 * 24 * 3600_000) }, { uid: true })) || [];
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { headers: [WARMUP_HEADER] }, { uid: true });
      const headerText = msg && msg.headers ? msg.headers.toString() : "";
      const value = /x-mithmill-warmup:\s*(\S+)/i.exec(headerText)?.[1];
      const tag = parseWarmupHeader(value);
      await client.messageFlagsAdd(String(uid), ["\\Seen", "\\Flagged"], { uid: true }).catch(() => undefined);
      await client.messageMove(String(uid), "INBOX", { uid: true });
      rescued++;
      if (tag && !tag.isReply) {
        await db.warmupLog.updateMany({ where: { id: tag.logId }, data: { landedInSpam: true } });
      }
    }
  } finally {
    lock.release();
  }
  return rescued;
}
