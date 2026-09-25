import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { EmailAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { createImapClient } from "@/server/mail/clients";
import { processInbound, type InboundMessage } from "./reply-processor";
import { handleWarmupInbound, rescueFromSpam, WARMUP_HEADER } from "./warmup-inbound";

const MAX_PER_RUN = 200;

function firstAddress(a: AddressObject | AddressObject[] | undefined): string {
  const obj = Array.isArray(a) ? a[0] : a;
  return obj?.value?.[0]?.address?.toLowerCase() ?? "";
}

function refsOf(mail: ParsedMail): string[] {
  const r = mail.references;
  return Array.isArray(r) ? r : r ? r.split(/\s+/).filter(Boolean) : [];
}

export function isBounceMessage(mail: ParsedMail): boolean {
  const from = firstAddress(mail.from);
  const ct = String(mail.headers.get("content-type") ?? "");
  const ctValue = typeof ct === "object" ? JSON.stringify(ct) : ct;
  return /^(mailer-daemon|postmaster)@/i.test(from) || /multipart\/report/i.test(ctValue) || /report-type=?"?delivery-status/i.test(ctValue);
}

export function toInbound(mail: ParsedMail): InboundMessage {
  return {
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: refsOf(mail),
    from: firstAddress(mail.from),
    to: firstAddress(mail.to),
    subject: mail.subject ?? null,
    text: mail.text ?? "",
    html: typeof mail.html === "string" ? mail.html : null,
    date: mail.date ?? new Date(),
    isBounce: isBounceMessage(mail),
  };
}

export interface SyncResult {
  fetched: number;
  replies: number;
  bounces: number;
  warmups: number;
  rescued: number;
}

/** Pulls new INBOX messages since the last seen UID and routes them. */
export async function syncInbox(account: EmailAccount): Promise<SyncResult> {
  const result: SyncResult = { fetched: 0, replies: 0, bounces: 0, warmups: 0, rescued: 0 };
  const client = await createImapClient(account);
  await client.connect();
  try {
    // Warm-up first: anything rescued from spam lands in INBOX and is handled below.
    if (account.isWarmupEnabled) result.rescued = await rescueFromSpam(client).catch(() => 0);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const uidNext = mailbox && typeof mailbox === "object" ? Number(mailbox.uidNext ?? 0) : 0;
      let lastUid = account.imapLastUid ?? 0;
      if (lastUid >= uidNext) lastUid = 0; // UIDVALIDITY reset or mailbox recreated

      const range = lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { since: new Date(Date.now() - 2 * 24 * 3600 * 1000) };
      const uids = ((await client.search(range, { uid: true })) || []).filter((u) => u > lastUid).slice(-MAX_PER_RUN);
      let maxUid = lastUid;

      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true, uid: true }, { uid: true });
        maxUid = Math.max(maxUid, uid);
        if (!msg || !msg.source) continue;
        const mail = await simpleParser(msg.source);
        result.fetched++;
        const from = firstAddress(mail.from);
        if (from === account.emailAddress.toLowerCase()) continue; // our own sent copy

        if (mail.headers.has(WARMUP_HEADER)) {
          await handleWarmupInbound(client, account, mail, uid, "INBOX");
          result.warmups++;
          continue;
        }
        const outcome = await processInbound(account, toInbound(mail));
        if (outcome === "reply") result.replies++;
        if (outcome === "bounce") result.bounces++;
      }
      if (maxUid !== account.imapLastUid) {
        await db.emailAccount.update({ where: { id: account.id }, data: { imapLastUid: maxUid } });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return result;
}
