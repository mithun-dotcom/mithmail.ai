"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ThreadSummaryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { domainOf } from "@/lib/utils";
import { textToHtml } from "@/lib/template";
import { requireWorkspace } from "@/server/workspace";
import { transportFor } from "@/server/mail/pool";
import { enrollSubsequences } from "@/server/inbox/reply-processor";
import { emitEvent } from "@/server/services/webhooks";

const LABELS = ["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "UNSUBSCRIBE_REQUEST", "NEUTRAL"] as const;

async function ownThread(id: string) {
  const { workspace } = await requireWorkspace();
  const thread = await db.thread.findFirst({ where: { id, workspaceId: workspace.id }, include: { messages: { orderBy: { receivedAt: "asc" } } } });
  if (!thread) throw new Error("Thread not found");
  return { thread, workspace };
}

export async function markRead(id: string, isRead = true) {
  await ownThread(id);
  await db.thread.update({ where: { id }, data: { isRead } });
  revalidatePath("/unibox");
}

export async function setLabel(id: string, label: ThreadSummaryStatus | null) {
  const { thread, workspace } = await ownThread(id);
  const parsed = label === null ? null : z.enum(LABELS).parse(label);
  await db.thread.update({ where: { id }, data: { summaryStatus: parsed } });
  if (parsed && thread.leadId && thread.campaignId && parsed !== thread.summaryStatus) {
    await enrollSubsequences(thread.campaignId, thread.leadId, parsed);
    const event = parsed === "INTERESTED" ? "lead.interested" : parsed === "MEETING_BOOKED" ? "lead.meeting_booked" : parsed === "NOT_INTERESTED" ? "lead.not_interested" : null;
    if (event) await emitEvent(workspace.id, event, { leadEmail: thread.leadEmail, campaignId: thread.campaignId, manual: true });
  }
  revalidatePath("/unibox");
}

export async function sendReply(threadId: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const { thread, workspace } = await ownThread(threadId);
  const text = z.string().trim().min(1).max(20000).safeParse(body);
  if (!text.success) return { error: "Write a message first." };

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
