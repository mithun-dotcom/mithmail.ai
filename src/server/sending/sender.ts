import { db } from "@/lib/db";
import { transportFor, dropTransport } from "@/server/mail/pool";
import { emitEvent } from "@/server/services/webhooks";
import { loadBlocklist } from "@/server/services/leads";
import { composeEmail } from "./compose";

const DAY = 24 * 3600 * 1000;

export class RetryableSendError extends Error {}

const BOUNCE_WINDOW_MS = 24 * 3600_000;
const BOUNCE_MIN_SAMPLE = 20;
const BOUNCE_MAX_RATE = 0.05;

/** Bounce protection: pause an inbox whose 24h hard-bounce rate exceeds 5% (min. 20 sends). */
export async function enforceBounceProtection(emailAccountId: string) {
  const since = new Date(Date.now() - BOUNCE_WINDOW_MS);
  const [sent, bounced] = await Promise.all([
    db.emailLog.count({ where: { emailAccountId, sentAt: { gte: since } } }),
    db.emailLog.count({ where: { emailAccountId, status: "BOUNCED", sentAt: { gte: since } } }),
  ]);
  if (sent >= BOUNCE_MIN_SAMPLE && bounced / sent > BOUNCE_MAX_RATE) {
    await db.emailAccount.update({
      where: { id: emailAccountId },
      data: { status: "PAUSED", lastError: `Auto-paused: ${bounced}/${sent} emails bounced in 24h (>${BOUNCE_MAX_RATE * 100}%). Clean your lead list, then resume.` },
    });
    return true;
  }
  return false;
}

type SmtpError = Error & { responseCode?: number; command?: string; code?: string };

export function classifySmtpError(e: SmtpError): "bounce" | "auth" | "retry" {
  const code = e.responseCode ?? 0;
  if (code === 535 || code === 534 || code === 530 || e.code === "EAUTH") return "auth";
  if (code >= 550 && code <= 554 && (e.command === "RCPT TO" || /user unknown|does not exist|no such user|mailbox unavailable|recipient/i.test(e.message))) {
    return "bounce";
  }
  if (e.code === "EENVELOPE" && code >= 500) return "bounce";
  return "retry";
}

/** Returns the lead to the queue without advancing its step. */
async function release(campaignLeadWhere: { campaignId: string; leadId: string }, delayMs = 0) {
  await db.campaignLead.updateMany({ where: { ...campaignLeadWhere, status: "ACTIVE" }, data: { nextSendAt: new Date(Date.now() + delayMs) } });
}

export async function processSendJob(emailLogId: string, isFinalAttempt: boolean): Promise<string> {
  const log = await db.emailLog.findUnique({
    where: { id: emailLogId },
    include: {
      campaign: { include: { steps: { orderBy: { stepNumber: "asc" } } } },
      campaignStep: true,
      lead: true,
      emailAccount: { include: { trackingDomain: true } },
    },
  });
  if (!log || log.status !== "QUEUED") return "skipped: not queued";
  const { campaign, lead, emailAccount: account, campaignStep: step } = log;
  const clWhere = { campaignId: campaign.id, leadId: lead.id };

  // Re-validate everything at send time — state may have changed since scheduling.
  const cancel = async (reason: string, requeue: boolean) => {
    await db.emailLog.delete({ where: { id: log.id } });
    if (requeue) await release(clWhere);
    return `cancelled: ${reason}`;
  };
  if (!step) return cancel("step deleted", true);
  if (campaign.status !== "ACTIVE") return cancel("campaign not active", true);
  if (account.status !== "ACTIVE") return cancel("inbox not active", true);
  const cl = await db.campaignLead.findUnique({ where: { campaignId_leadId: clWhere } });
  if (!cl || cl.status !== "ACTIVE") return cancel("lead no longer active in campaign", false);
  if (lead.status === "BOUNCED" || lead.status === "UNSUBSCRIBED") {
    await db.campaignLead.updateMany({ where: clWhere, data: { status: "FINISHED" } });
    return cancel(`lead ${lead.status.toLowerCase()}`, false);
  }
  if ((await loadBlocklist(campaign.workspaceId))(lead.email)) {
    await db.campaignLead.updateMany({ where: clWhere, data: { status: "FINISHED" } });
    return cancel("blocklisted", false);
  }

  const previousLogs = await db.emailLog.findMany({
    where: { campaignId: campaign.id, leadId: lead.id, status: { notIn: ["QUEUED", "FAILED"] }, sentAt: { not: null } },
    orderBy: { sentAt: "asc" },
    select: { subject: true, messageId: true },
  });
  const firstWithSubject = previousLogs.find((p) => p.subject);
  const last = previousLogs.at(-1);
  const previous = last
    ? {
        subject: firstWithSubject?.subject ?? null,
        messageId: last.messageId,
        references: previousLogs.slice(0, -1).map((p) => p.messageId).filter((m): m is string => !!m),
      }
    : null;

  const email = composeEmail({ logId: log.id, campaign, step, lead, account, previous });

  try {
    const transport = await transportFor(account);
    await transport.sendMail({
      from: email.from.name ? { name: email.from.name, address: email.from.address } : email.from.address,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      headers: email.headers,
    });
  } catch (err) {
    const e = err as SmtpError;
    const kind = classifySmtpError(e);
    if (kind === "bounce") {
      const now = new Date();
      await db.$transaction([
        db.emailLog.update({ where: { id: log.id }, data: { status: "BOUNCED", sentAt: now, bouncedAt: now, errorMessage: e.message, subject: email.subject } }),
        db.lead.update({ where: { id: lead.id }, data: { status: "BOUNCED" } }),
        db.campaignLead.updateMany({ where: { leadId: lead.id, status: "ACTIVE" }, data: { status: "FINISHED", nextSendAt: null } }),
      ]);
      await emitEvent(campaign.workspaceId, "email.bounced", { leadEmail: lead.email, campaignId: campaign.id, reason: e.message });
      await enforceBounceProtection(account.id);
      return "bounced";
    }
    if (kind === "auth") {
      dropTransport(account.id);
      await db.emailAccount.update({ where: { id: account.id }, data: { status: "ERROR", lastError: `SMTP auth failed: ${e.message}` } });
      await db.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", errorMessage: e.message } });
      await release(clWhere, 5 * 60_000);
      return "failed: auth";
    }
    if (isFinalAttempt) {
      await db.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", errorMessage: e.message } });
      await release(clWhere, 30 * 60_000);
      return "failed: retries exhausted";
    }
    throw new RetryableSendError(e.message);
  }

  // Success: record and advance the lead.
  const now = new Date();
  const nextStep = campaign.steps.find((s) => s.stepNumber === step.stepNumber + 1);
  await db.$transaction([
    db.emailLog.update({
      where: { id: log.id },
      data: { status: "SENT", sentAt: now, messageId: email.messageId, subject: email.subject, variantId: email.variantId, body: email.displayHtml, errorMessage: null },
    }),
    ...(lead.status === "UNCONTACTED" ? [db.lead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } })] : []),
    db.campaignLead.updateMany({
      where: clWhere,
      data: nextStep
        ? { currentStepNumber: step.stepNumber, nextSendAt: new Date(now.getTime() + Math.max(nextStep.waitDays, 0) * DAY) }
        : { currentStepNumber: step.stepNumber, status: "FINISHED", nextSendAt: null },
    }),
  ]);
  await emitEvent(campaign.workspaceId, "email.sent", { leadEmail: lead.email, campaignId: campaign.id, step: step.stepNumber, from: account.emailAddress });
  return "sent";
}
