import type { EmailAccount, ThreadSummaryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyReply } from "@/server/ai";
import { emitEvent, type WebhookEvent } from "@/server/services/webhooks";
import { enforceBounceProtection } from "@/server/sending/sender";

export interface InboundMessage {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string; // address, lower-case
  to: string;
  subject: string | null;
  text: string;
  html: string | null;
  date: Date;
  isBounce: boolean;
}

const LABEL_EVENTS: Partial<Record<ThreadSummaryStatus, WebhookEvent>> = {
  INTERESTED: "lead.interested",
  MEETING_BOOKED: "lead.meeting_booked",
  NOT_INTERESTED: "lead.not_interested",
};

/** Strips quoted history so classification only sees what the lead actually wrote. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^On .+wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From: .+/i.test(line) || /^_{5,}/.test(line)) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const MSGID_RE = /<[^<>\s]+@[^<>\s]+>/g;

/** Finds the EmailLog a bounce (DSN) refers to by scanning for our Message-IDs in the report. */
async function handleBounce(account: EmailAccount, msg: InboundMessage): Promise<boolean> {
  const ids = [...new Set([...(msg.text.match(MSGID_RE) ?? []), ...msg.references, ...(msg.inReplyTo ? [msg.inReplyTo] : [])])];
  if (!ids.length) return false;
  const log = await db.emailLog.findFirst({
    where: { messageId: { in: ids }, emailAccountId: account.id },
    include: { campaign: { select: { workspaceId: true } }, lead: true },
  });
  if (!log) return false;
  const now = new Date();
  await db.$transaction([
    db.emailLog.update({ where: { id: log.id }, data: { status: "BOUNCED", bouncedAt: now, errorMessage: msg.text.slice(0, 500) } }),
    db.lead.update({ where: { id: log.leadId }, data: { status: "BOUNCED" } }),
    db.campaignLead.updateMany({ where: { leadId: log.leadId, status: "ACTIVE" }, data: { status: "FINISHED", nextSendAt: null } }),
  ]);
  await emitEvent(log.campaign.workspaceId, "email.bounced", { leadEmail: log.lead.email, campaignId: log.campaignId });
  await enforceBounceProtection(account.id);
  return true;
}

/**
 * Processes one inbound email for an inbox. Replies are matched by In-Reply-To /
 * References against EmailLog.messageId, falling back to the sender address of a
 * lead this inbox has emailed.
 */
export async function processInbound(account: EmailAccount, msg: InboundMessage): Promise<"duplicate" | "bounce" | "reply" | "ignored"> {
  if (msg.messageId && (await db.message.findUnique({ where: { messageId: msg.messageId } }))) return "duplicate";
  if (msg.isBounce) return (await handleBounce(account, msg)) ? "bounce" : "ignored";

  const refIds = [...msg.references, ...(msg.inReplyTo ? [msg.inReplyTo] : [])];
  let log = refIds.length
    ? await db.emailLog.findFirst({ where: { messageId: { in: refIds } }, orderBy: { sentAt: "desc" }, include: { campaign: true, lead: true } })
    : null;
  if (!log) {
    log = await db.emailLog.findFirst({
      where: { emailAccountId: account.id, lead: { email: msg.from }, sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      include: { campaign: true, lead: true },
    });
  }
  if (!log || log.campaign.workspaceId !== account.workspaceId) return "ignored";
  const { campaign, lead } = log;

  const ownText = stripQuoted(msg.text) || msg.text;
  const label = await classifyReply(`Subject: ${msg.subject ?? ""}\n\n${ownText}`);
  const isRealReply = label !== "OUT_OF_OFFICE";
  const now = new Date();

  // One thread per lead per workspace; backfill our outbound emails so the Unibox shows the whole conversation.
  let thread = await db.thread.findFirst({ where: { workspaceId: account.workspaceId, leadEmail: lead.email }, orderBy: { lastMessageAt: "desc" } });
  if (!thread) {
    thread = await db.thread.create({
      data: { workspaceId: account.workspaceId, leadId: lead.id, campaignId: campaign.id, leadEmail: lead.email, subject: log.subject ?? msg.subject },
    });
  }
  const outbound = await db.emailLog.findMany({
    where: { leadId: lead.id, campaign: { workspaceId: account.workspaceId }, sentAt: { not: null }, messageId: { not: null } },
    include: { emailAccount: { select: { emailAddress: true } } },
  });
  for (const o of outbound) {
    await db.message.upsert({
      where: { messageId: o.messageId! },
      create: {
        threadId: thread.id,
        emailAccountId: o.emailAccountId,
        direction: "OUTBOUND",
        messageId: o.messageId,
        fromEmail: o.emailAccount.emailAddress,
        toEmail: lead.email,
        subject: o.subject,
        body: o.body ?? "",
        receivedAt: o.sentAt!,
      },
      update: {},
    });
  }
  await db.message.create({
    data: {
      threadId: thread.id,
      emailAccountId: account.id,
      direction: "INBOUND",
      messageId: msg.messageId,
      inReplyTo: msg.inReplyTo,
      fromEmail: msg.from,
      toEmail: msg.to || account.emailAddress,
      subject: msg.subject,
      body: msg.html ?? msg.text,
      receivedAt: msg.date,
    },
  });
  await db.thread.update({
    where: { id: thread.id },
    data: {
      lastMessageAt: msg.date > thread.lastMessageAt ? msg.date : thread.lastMessageAt,
      isRead: false,
      // An auto-reply never overwrites a meaningful label.
      summaryStatus: isRealReply || !thread.summaryStatus ? label : thread.summaryStatus,
      campaignId: thread.campaignId ?? campaign.id,
      leadId: thread.leadId ?? lead.id,
    },
  });

  if (isRealReply) {
    await db.emailLog.updateMany({ where: { id: log.id, repliedAt: null }, data: { repliedAt: now, status: "REPLIED" } });
    await db.lead.update({ where: { id: lead.id }, data: { status: label === "UNSUBSCRIBE_REQUEST" ? "UNSUBSCRIBED" : "REPLIED" } });
    // Stop-on-reply: pause this lead in every campaign that asks for it.
    await db.campaignLead.updateMany({
      where: { leadId: lead.id, status: "ACTIVE", campaign: { stopOnReply: true } },
      data: { status: "PAUSED", nextSendAt: null },
    });
    if (label === "UNSUBSCRIBE_REQUEST") {
      await db.campaignLead.updateMany({ where: { leadId: lead.id, status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "FINISHED", nextSendAt: null } });
      await db.globalBlocklist.upsert({
        where: { workspaceId_emailOrDomain: { workspaceId: account.workspaceId, emailOrDomain: lead.email } },
        create: { workspaceId: account.workspaceId, emailOrDomain: lead.email },
        update: {},
      });
    }
    await emitEvent(account.workspaceId, "lead.replied", { leadEmail: lead.email, campaignId: campaign.id, label, subject: msg.subject, text: ownText.slice(0, 2000) });
    const labelEvent = LABEL_EVENTS[label];
    if (labelEvent) await emitEvent(account.workspaceId, labelEvent, { leadEmail: lead.email, campaignId: campaign.id });
    if (label !== "UNSUBSCRIBE_REQUEST") await enrollSubsequences(campaign.id, lead.id, label);
  }
  return "reply";
}

/** Moves a lead into child campaigns whose trigger matches the reply label. */
export async function enrollSubsequences(parentCampaignId: string, leadId: string, label: ThreadSummaryStatus) {
  const subs = await db.campaign.findMany({
    where: { parentCampaignId, triggerLabel: label, status: { in: ["ACTIVE", "DRAFT", "PAUSED"] } },
    select: { id: true },
  });
  for (const s of subs) {
    await db.campaignLead.upsert({
      where: { campaignId_leadId: { campaignId: s.id, leadId } },
      create: { campaignId: s.id, leadId, nextSendAt: new Date() },
      update: {},
    });
  }
  return subs.length;
}
