"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ThreadSummaryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { domainOf } from "@/lib/utils";
import { htmlToText, textToHtml } from "@/lib/template";
import { aiEnabled, suggestReply } from "@/server/ai";
import { stripQuoted } from "@/server/inbox/reply-processor";
import { requireWorkspace } from "@/server/workspace";
import { transportFor } from "@/server/mail/pool";
import { enrollSubsequences } from "@/server/inbox/reply-processor";
import { emitEvent } from "@/server/services/webhooks";
import { clientFor, SB_THREAD_PREFIX } from "@/server/salesblink/service";

const SB_OUTCOME: Partial<Record<ThreadSummaryStatus, string>> = {
  INTERESTED: "positive",
  MEETING_BOOKED: "positive",
  NOT_INTERESTED: "negative",
  NEUTRAL: "neutral",
};

/** SalesBlink thread handle (their messageId) if this conversation lives on SalesBlink. */
function sbThreadId(messages: { inReplyTo: string | null }[]): string | null {
  const m = [...messages].reverse().find((x) => x.inReplyTo?.startsWith(SB_THREAD_PREFIX));
  return m ? m.inReplyTo!.slice(SB_THREAD_PREFIX.length) : null;
}

const LABELS = ["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "UNSUBSCRIBE_REQUEST", "NEUTRAL"] as const;

async function ownThread(id: string, minRole: "VIEWER" | "ADMIN" = "VIEWER") {
  const { workspace } = await requireWorkspace(minRole);
  const thread = await db.thread.findFirst({ where: { id, workspaceId: workspace.id }, include: { messages: { orderBy: { receivedAt: "asc" } } } });
  if (!thread) throw new Error("Thread not found");
  return { thread, workspace };
}

export async function markRead(id: string, isRead = true) {
  const { thread, workspace } = await ownThread(id);
  await db.thread.update({ where: { id }, data: { isRead } });
  const sbId = sbThreadId(thread.messages);
  if (sbId) await clientFor(workspace).updateMail(sbId, { unread: !isRead }).catch(() => undefined);
  revalidatePath("/unibox");
}

export async function setLabel(id: string, label: ThreadSummaryStatus | null) {
  const { thread, workspace } = await ownThread(id, "ADMIN");
  const parsed = label === null ? null : z.enum(LABELS).parse(label);
  await db.thread.update({ where: { id }, data: { summaryStatus: parsed } });
  const sbId = sbThreadId(thread.messages);
  if (sbId && parsed && SB_OUTCOME[parsed]) await clientFor(workspace).updateMail(sbId, { outcome: SB_OUTCOME[parsed] }).catch(() => undefined);
  if (parsed && thread.leadId && thread.campaignId && parsed !== thread.summaryStatus) {
    await enrollSubsequences(thread.campaignId, thread.leadId, parsed);
    const event = parsed === "INTERESTED" ? "lead.interested" : parsed === "MEETING_BOOKED" ? "lead.meeting_booked" : parsed === "NOT_INTERESTED" ? "lead.not_interested" : null;
    if (event) await emitEvent(workspace.id, event, { leadEmail: thread.leadEmail, campaignId: thread.campaignId, manual: true });
  }
  revalidatePath("/unibox");
}

export async function sendReply(threadId: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const { thread, workspace } = await ownThread(threadId, "ADMIN");
  const text = z.string().trim().min(1).max(20000).safeParse(body);
  if (!text.success) return { error: "Write a message first." };

  // SalesBlink conversation: reply through SalesBlink (same sender, same thread).
  const sbId = sbThreadId(thread.messages);
  if (sbId) {
    const html = textToHtml(text.data);
    try {
      await clientFor(workspace).reply(sbId, html);
    } catch (e) {
      return { error: `SalesBlink: ${(e as Error).message}` };
    }
    const lastIn = [...thread.messages].reverse().find((m) => m.direction === "INBOUND");
    const now = new Date();
    await db.$transaction([
      db.message.create({
        data: {
          threadId,
          emailAccountId: lastIn?.emailAccountId ?? null,
          direction: "OUTBOUND",
          messageId: `sb:reply:${randomUUID()}`,
          inReplyTo: `${SB_THREAD_PREFIX}${sbId}`,
          fromEmail: lastIn?.toEmail || "via SalesBlink",
          toEmail: thread.leadEmail,
          subject: lastIn?.subject ? (/^re:/i.test(lastIn.subject) ? lastIn.subject : `Re: ${lastIn.subject}`) : thread.subject,
          body: html,
          receivedAt: now,
        },
      }),
      db.thread.update({ where: { id: threadId }, data: { lastMessageAt: now, isRead: true } }),
    ]);
    revalidatePath("/unibox");
    return { ok: true };
  }

  // Reply from the inbox the lead last wrote to (or last emailed them from).
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "INBOUND");
  const anchor = lastInbound ?? thread.messages.at(-1);
  const accountId = anchor?.emailAccountId;
  if (!accountId) return { error: "No inbox is associated with this conversation." };
  const account = await db.emailAccount.findFirst({ where: { id: accountId, workspaceId: workspace.id } });
  if (!account) return { error: "The inbox for this conversation was removed." };

  const references = thread.messages.map((m) => m.messageId).filter((m): m is string => !!m);
  const baseSubject = anchor?.subject ?? thread.subject ?? "";
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
  const messageId = `<${randomUUID()}@${domainOf(account.emailAddress)}>`;
  let html = textToHtml(text.data);
  if (account.signature) html += `<br>${/<[a-z]/i.test(account.signature) ? account.signature : textToHtml(account.signature)}`;

  try {
    const transport = await transportFor(account);
    await transport.sendMail({
      from: account.fromName ? { name: account.fromName, address: account.emailAddress } : account.emailAddress,
      to: thread.leadEmail,
      subject,
      text: text.data,
      html,
      messageId,
      inReplyTo: anchor?.messageId ?? undefined,
      references,
    });
  } catch (e) {
    return { error: `Send failed: ${(e as Error).message}` };
  }
  const now = new Date();
  await db.$transaction([
    db.message.create({
      data: { threadId, emailAccountId: account.id, direction: "OUTBOUND", messageId, inReplyTo: anchor?.messageId, fromEmail: account.emailAddress, toEmail: thread.leadEmail, subject, body: html, receivedAt: now },
    }),
    db.thread.update({ where: { id: threadId }, data: { lastMessageAt: now, isRead: true } }),
  ]);
  revalidatePath("/unibox");
  return { ok: true };
}

export async function suggestReplyAction(threadId: string): Promise<{ reply?: string; error?: string }> {
  const { thread } = await ownThread(threadId, "ADMIN");
  if (!aiEnabled()) return { error: "Set OPENAI_API_KEY to enable AI replies." };
  try {
    const conversation = thread.messages.map((m) => {
      const text = htmlToText(m.body);
      return { direction: m.direction, text: m.direction === "INBOUND" ? stripQuoted(text) || text : text };
    });
    return { reply: await suggestReply(conversation) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
