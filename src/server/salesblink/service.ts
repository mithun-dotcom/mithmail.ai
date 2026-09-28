/**
 * SalesBlink engine: MithMill stays the product (campaigns, leads, Unibox, analytics);
 * SalesBlink does the sending, warm-up and inbox monitoring.
 *
 * Personalisation: SalesBlink templates only support plain {{merge_tags}} — no spintax,
 * fallbacks or A/B variants. So MithMill renders every lead's email itself and pushes the
 * result as per-lead contact fields (mm_subject_N / mm_body_N). Each SalesBlink template is
 * just "{{mm_subject_N}}" / "{{mm_body_N}}", which keeps every MithMill feature intact.
 */
import type { Campaign, CampaignStep, EmailAccount, Lead, Prisma, Workspace } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { render, seededRng, textToHtml, type Vars } from "@/lib/template";
import { pickVariant, leadVars } from "@/server/sending/compose";
import { classifyReply } from "@/server/ai";
import { emitEvent } from "@/server/services/webhooks";
import { enrollSubsequences, stripQuoted } from "@/server/inbox/reply-processor";
import { htmlToText } from "@/lib/template";
import { SalesBlinkClient, type SbActivity, type SbSendingHour } from "./client";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CONTACT_BATCH = 500;

// ---------------------------------------------------------------------------
// Client resolution
// ---------------------------------------------------------------------------

/**
 * Each MithMill workspace talks to its own SalesBlink workspace through its own key — never a
 * shared fallback, so one client's inboxes and leads can't end up in another's SalesBlink workspace.
 */
export function salesblinkKey(ws: Pick<Workspace, "salesblinkApiKeyEnc">): string | null {
  return ws.salesblinkApiKeyEnc ? decrypt(ws.salesblinkApiKeyEnc) : null;
}

export function clientFor(ws: Pick<Workspace, "salesblinkApiKeyEnc">): SalesBlinkClient {
  const key = salesblinkKey(ws);
  if (!key) throw new Error("This workspace isn't linked to its SalesBlink workspace yet (Settings → SalesBlink).");
  return new SalesBlinkClient(key);
}

async function workspaceClient(workspaceId: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  return { ws, client: clientFor(ws) };
}

// ---------------------------------------------------------------------------
// Senders (inboxes) + warm-up
// ---------------------------------------------------------------------------

function providerOf(raw: string | undefined, email: string): EmailAccount["provider"] {
  const p = (raw ?? "").toLowerCase();
  if (p.includes("google") || p.includes("gmail")) return "GOOGLE";
  if (p.includes("outlook") || p.includes("microsoft") || p.includes("office")) return "MICROSOFT";
  if (/@(gmail|googlemail)\.com$/.test(email)) return "GOOGLE";
  if (/@(outlook|hotmail|live)\.com$/.test(email)) return "MICROSOFT";
  return "SMTP";
}

/** Mirrors SalesBlink senders into EmailAccount rows and refreshes the stalest health scores. */
export async function syncSenders(workspaceId: string, opts: { healthBudget?: number } = {}) {
  const { ws, client } = await workspaceClient(workspaceId);
  const senders = await client.listSenders();
  const seen = new Set<string>();

  for (const s of senders) {
    seen.add(s.id);
    const existing =
      (await db.emailAccount.findUnique({ where: { workspaceId_salesblinkSenderId: { workspaceId: ws.id, salesblinkSenderId: s.id } } })) ??
      (await db.emailAccount.findUnique({ where: { workspaceId_emailAddress: { workspaceId: ws.id, emailAddress: s.email } } }));
    if (existing) {
      await db.emailAccount.update({
        where: { id: existing.id },
        data: { salesblinkSenderId: s.id, fromName: existing.fromName ?? s.name ?? null },
      });
    } else {
      await db.emailAccount.create({
        data: {
          workspaceId: ws.id,
          emailAddress: s.email,
          fromName: s.name ?? null,
          provider: providerOf(s.provider, s.email),
          salesblinkSenderId: s.id,
        },
      });
    }
  }

  // Senders removed in SalesBlink.
  await db.emailAccount.updateMany({
    where: { workspaceId: ws.id, salesblinkSenderId: { not: null, notIn: [...seen] } },
    data: { status: "DISCONNECTED", lastError: "Sender no longer exists in SalesBlink." },
  });

  // Health is one GET per sender — refresh the stalest few per run to respect rate limits.
  const stale = await db.emailAccount.findMany({
    where: { workspaceId: ws.id, salesblinkSenderId: { in: [...seen] } },
    orderBy: { externalSyncedAt: { sort: "asc", nulls: "first" } },
    take: opts.healthBudget ?? 12,
  });
  for (const a of stale) await refreshSenderHealth(client, a);
  return { senders: senders.length, healthRefreshed: stale.length };
}

export async function refreshSenderHealth(client: SalesBlinkClient, account: EmailAccount) {
  if (!account.salesblinkSenderId) return;
  try {
    const h = await client.senderHealth(account.salesblinkSenderId);
    const healthy = h.connected !== false && h.sending_enabled !== false;
    const err = h.error ? (typeof h.error === "string" ? h.error : JSON.stringify(h.error)).slice(0, 300) : null;
    await db.emailAccount.update({
      where: { id: account.id },
      data: {
        healthScore: Math.round(h.health_score ?? 0),
        isWarmupEnabled: !!h.warmup_enabled,
        status: account.status === "PAUSED" ? "PAUSED" : healthy ? "ACTIVE" : "ERROR",
        lastError: healthy ? null : (err ?? "Sender is disconnected in SalesBlink — reconnect it."),
        externalStats: { bounceRate: h.bounce_rate, replyRate: h.reply_rate, last7Days: h.last_7_days, warmup30Days: h.warmup_30_days } as Prisma.InputJsonValue,
        externalSyncedAt: new Date(),
      },
    });
  } catch (e) {
    await db.emailAccount.update({ where: { id: account.id }, data: { externalSyncedAt: new Date(), lastError: `SalesBlink health: ${(e as Error).message}`.slice(0, 300) } });
  }
}

/** Pushes MithMill's warm-up / volume settings for one inbox to SalesBlink. */
export async function pushSenderSettings(account: EmailAccount) {
  if (!account.salesblinkSenderId) return;
  const { client } = await workspaceClient(account.workspaceId);
  await client.updateSender(account.salesblinkSenderId, {
    warmup_enabled: account.isWarmupEnabled,
    auto_ramp_up_enabled: true,
    ramp_up_frequency: Math.min(50, account.warmupRampUp),
    max_daily_frequency: Math.min(50, account.warmupDailyLimit),
    sequence_max_daily_frequency: account.dailyLimit,
    pause_cold_emails_when_health_low: true,
    pause_cold_emails_health_threshold: 60,
  });
}

// ---------------------------------------------------------------------------
// Personalised content
// ---------------------------------------------------------------------------

type StepLike = Pick<CampaignStep, "id" | "stepNumber" | "subject" | "bodySpintax" | "bodyHtml" | "abTestVariants">;

/** Renders every step for one lead into SalesBlink contact fields (snake_case). */
export function renderLeadFields(
  campaign: Pick<Campaign, "scheduleTimezone" | "sendAsPlainText">,
  steps: StepLike[],
  lead: Lead,
  sender: Pick<EmailAccount, "emailAddress" | "fromName" | "signature"> | null,
  now = new Date(),
): Record<string, string> {
  const vars: Vars = sender
    ? leadVars(lead, sender as EmailAccount, campaign.scheduleTimezone, now)
    : { ...((lead.customVariables as Record<string, string> | null) ?? {}), first_name: lead.firstName, last_name: lead.lastName, email: lead.email, company_name: lead.companyName, company: lead.companyName };
  const fields: Record<string, string> = {
    email: lead.email,
    first_name: lead.firstName ?? "",
    last_name: lead.lastName ?? "",
    company_name: lead.companyName ?? "",
  };
  let firstSubject = "";
  for (const step of [...steps].sort((a, b) => a.stepNumber - b.stepNumber)) {
    const rng = seededRng(`${lead.id}:${step.id}`);
    const variant = pickVariant(step as CampaignStep, `${lead.id}:${step.id}`);
    let subject = render(variant.subject, vars, rng).trim();
    if (step.stepNumber === 1) firstSubject = subject;
    // Blank follow-up subject = reply in the same thread.
    if (!subject && firstSubject) subject = `Re: ${firstSubject}`;
    const body = render(variant.body, vars, rng);
    const html = campaign.sendAsPlainText || /<(p|div|br|a|b|strong|ul|ol|li|table|span)\b/i.test(body) ? body : textToHtml(body);
    fields[`mm_subject_${step.stepNumber}`] = subject;
    fields[`mm_body_${step.stepNumber}`] = html;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

export function sendingHours(daysOfWeek: number[], startTime: string, endTime: string): SbSendingHour[] {
  // SalesBlink wants Monday..Sunday, every day present.
  return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ name: DAY_NAMES[d], enabled: daysOfWeek.includes(d), fromTime: startTime, toTime: endTime }));
}

async function loadCampaign(campaignId: string) {
  return db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      steps: { orderBy: { stepNumber: "asc" } },
      schedule: true,
      emailAccounts: { include: { emailAccount: true } },
      workspace: true,
    },
  });
}

/** Pushes campaign leads that aren't in the SalesBlink list yet, with their rendered emails. */
export async function pushLeads(campaignId: string) {
  const c = await loadCampaign(campaignId);
  if (!c.sbListId) return 0;
  const client = clientFor(c.workspace);
  const sender = c.emailAccounts[0]?.emailAccount ?? null;
  let pushed = 0;
  for (;;) {
    const batch = await db.campaignLead.findMany({
      where: { campaignId, sbPushedAt: null, status: "ACTIVE", lead: { status: { notIn: ["BOUNCED", "UNSUBSCRIBED"] } } },
      include: { lead: true },
      take: CONTACT_BATCH,
    });
    if (!batch.length) break;
    await client.addContacts(
      c.sbListId,
      batch.map((cl) => renderLeadFields(c, c.steps, cl.lead, sender)),
    );
    await db.campaignLead.updateMany({ where: { id: { in: batch.map((b) => b.id) } }, data: { sbPushedAt: new Date(), nextSendAt: null } });
    pushed += batch.length;
  }
  return pushed;
}

/** Queues a push of newly added leads for a campaign that already lives on SalesBlink. */
export async function queueLeadPush(campaignId: string) {
  const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { engine: true, sbListId: true } });
  if (c?.engine !== "SALESBLINK" || !c.sbListId) return false;
  const { getQueue, QUEUES } = await import("@/server/queue");
  await getQueue(QUEUES.salesblink).add("push-leads", { kind: "push-leads", campaignId }, { jobId: `sb-push-${campaignId}-${Math.floor(Date.now() / 60_000)}`, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
  return true;
}

export async function removeLeadsFromList(campaignId: string, emails: string[]) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { workspace: true } });
  if (!c.sbListId) return 0;
  const client = clientFor(c.workspace);
  for (const email of emails) await client.removeContact(c.sbListId, email).catch(() => undefined);
  return emails.length;
}

/**
 * Creates (or resumes creating) the SalesBlink list, templates and sequence for a campaign.
 * Idempotent: every created id is saved as soon as it exists, so a retry picks up where it stopped.
 */
export async function launchOnSalesblink(campaignId: string) {
  let c = await loadCampaign(campaignId);
  const client = clientFor(c.workspace);
  const tag = c.id.slice(0, 8);
  try {
    await db.campaign.update({ where: { id: c.id }, data: { sbLaunchState: "LAUNCHING", sbLaunchError: null } });

    const senders = c.emailAccounts.map((e) => e.emailAccount);
    const missing = senders.filter((a) => !a.salesblinkSenderId);
    if (!senders.length) throw new Error("Attach at least one SalesBlink inbox to this campaign.");
    if (missing.length) throw new Error(`These inboxes are not connected to SalesBlink: ${missing.map((m) => m.emailAddress).join(", ")}`);

    if (!c.sbListId) {
      const listId = await client.createList(`MithMill · ${c.name} [${tag}]`);
      await db.campaign.update({ where: { id: c.id }, data: { sbListId: listId } });
    }
    await pushLeads(c.id);

    for (const step of c.steps) {
      if (step.sbTemplateId) continue;
      const templateId = await client.createTemplate({
        name: `MithMill · ${c.name} · step ${step.stepNumber} [${tag}]`,
        subject: `{{mm_subject_${step.stepNumber}}}`,
        content: `{{mm_body_${step.stepNumber}}}`,
      });
      await db.campaignStep.update({ where: { id: step.id }, data: { sbTemplateId: templateId } });
    }
    c = await loadCampaign(c.id);

    if (!c.sbSequenceId) {
      const steps: ({ type: "email"; template_id: string } | { type: "delay"; days: number })[] = [];
      for (const st of c.steps) {
        if (st.stepNumber > 1 && st.waitDays > 0) steps.push({ type: "delay", days: st.waitDays });
        steps.push({ type: "email", template_id: st.sbTemplateId! });
      }
      const minDelay = Math.max(1, Math.round(Math.min(...senders.map((s) => s.minDelaySeconds)) / 60));
      const maxDelay = Math.max(minDelay, Math.round(Math.max(...senders.map((s) => s.maxDelaySeconds)) / 60));
      const sequenceId = await client.createSequence({
        name: `${c.name} [${tag}]`,
        senders: senders.map((s) => s.salesblinkSenderId!).join(","),
        lists: [c.sbListId!],
        steps,
        launchTimingMode: "now",
        timezone: c.scheduleTimezone,
        paused: false,
        delayEnabled: true,
        delayFrom: minDelay,
        delayTo: maxDelay,
        stopWhenReplyRecieved: c.stopOnReply,
        stopWhenReplyRecievedWhen: "contact",
        autoPause: true,
        auto_reply: true,
        plainText: c.sendAsPlainText,
        matchProvider: c.espMatching,
        checkEmailBeforeSending: false,
        emailSendingHours: c.schedule ? sendingHours(c.schedule.daysOfWeek, c.schedule.startTime, c.schedule.endTime) : undefined,
      });
      await db.campaign.update({ where: { id: c.id }, data: { sbSequenceId: sequenceId } });
    } else {
      await client.setSequenceStatus(c.sbSequenceId, "ACTIVE");
    }
    await db.campaign.update({ where: { id: c.id }, data: { status: "ACTIVE", sbLaunchState: "LAUNCHED", sbLaunchError: null } });
  } catch (e) {
    await db.campaign.update({ where: { id: c.id }, data: { sbLaunchState: "ERROR", sbLaunchError: (e as Error).message.slice(0, 1000), status: "PAUSED" } });
    throw e;
  }
}

export async function setSalesblinkCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED" | "STOPPED" | "ARCHIVED") {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { workspace: true } });
  if (!c.sbSequenceId) return;
  await clientFor(c.workspace).setSequenceStatus(c.sbSequenceId, status);
}

// ---------------------------------------------------------------------------
// Activity → EmailLog (so dashboards and campaign analytics work unchanged)
// ---------------------------------------------------------------------------

interface SyncState {
  sent?: number;
  opens?: number;
  clicks?: number;
  replies?: number;
  inbox?: number;
  sendersAt?: number;
}

async function campaignIndex(workspaceId: string) {
  const campaigns = await db.campaign.findMany({
    where: { workspaceId, engine: "SALESBLINK", sbSequenceId: { not: null } },
    include: { steps: { select: { id: true, stepNumber: true } }, emailAccounts: { include: { emailAccount: { select: { id: true, emailAddress: true } } } } },
  });
  return new Map(campaigns.map((c) => [c.sbSequenceId!, c]));
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export async function applyActivity(workspaceId: string, kind: "sent" | "opens" | "clicks" | "replies", events: SbActivity[]) {
  const byId = await campaignIndex(workspaceId);
  let applied = 0;
  for (const ev of [...events].sort((a, b) => a.time - b.time)) {
    const c = ev.sequence ? byId.get(ev.sequence) : undefined;
    if (!c || !ev.email) continue;
    const lead = await db.lead.findUnique({ where: { workspaceId_email: { workspaceId, email: ev.email.toLowerCase() } } });
    if (!lead) continue;
    const at = new Date(ev.time);

    if (kind === "sent") {
      const externalId = `sb:sent:${ev.id}`;
      if (await db.emailLog.findUnique({ where: { externalId } })) continue;
      const prior = await db.emailLog.count({ where: { campaignId: c.id, leadId: lead.id, sentAt: { not: null } } });
      const stepNumber = Math.min(prior + 1, c.steps.length || 1);
      const inText = (ev.message ?? "").match(EMAIL_RE)?.map((e) => e.toLowerCase()) ?? [];
      const sender = c.emailAccounts.find((e) => inText.includes(e.emailAccount.emailAddress))?.emailAccount ?? c.emailAccounts[0]?.emailAccount;
      if (!sender) continue;
      await db.emailLog.create({
        data: {
          campaignId: c.id,
          campaignStepId: c.steps.find((s) => s.stepNumber === stepNumber)?.id,
          leadId: lead.id,
          emailAccountId: sender.id,
          externalId,
          status: "SENT",
          sentAt: at,
          subject: ev.template_name ?? null,
        },
      });
      await db.campaignLead.updateMany({ where: { campaignId: c.id, leadId: lead.id }, data: { currentStepNumber: stepNumber, assignedAccountId: sender.id } });
      if (lead.status === "UNCONTACTED") await db.lead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
      applied++;
      continue;
    }

    const log = await db.emailLog.findFirst({ where: { campaignId: c.id, leadId: lead.id, sentAt: { not: null, lte: new Date(ev.time + 60_000) } }, orderBy: { sentAt: "desc" } });
    if (!log) continue;
    if (kind === "opens") {
      await db.emailLog.update({ where: { id: log.id }, data: { openCount: { increment: 1 }, openedAt: log.openedAt ?? at, ...(log.status === "SENT" ? { status: "OPENED" } : {}) } });
      if (!log.openedAt) await emitEvent(workspaceId, "email.opened", { leadEmail: lead.email, campaignId: c.id });
    } else if (kind === "clicks") {
      await db.emailLog.update({
        where: { id: log.id },
        data: { clickCount: { increment: 1 }, clickedAt: log.clickedAt ?? at, openedAt: log.openedAt ?? at, ...(["SENT", "OPENED"].includes(log.status) ? { status: "CLICKED" } : {}) },
      });
      if (!log.clickedAt) await emitEvent(workspaceId, "email.clicked", { leadEmail: lead.email, campaignId: c.id });
    } else if (kind === "replies" && !log.repliedAt) {
      await db.emailLog.update({ where: { id: log.id }, data: { repliedAt: at, status: "REPLIED" } });
      if (lead.status !== "UNSUBSCRIBED") await db.lead.update({ where: { id: lead.id }, data: { status: "REPLIED" } });
      if (c.stopOnReply) await db.campaignLead.updateMany({ where: { campaignId: c.id, leadId: lead.id, status: "ACTIVE" }, data: { status: "PAUSED" } });
    }
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Inbox → Unibox threads
// ---------------------------------------------------------------------------

export const SB_THREAD_PREFIX = "sb-thread:";

export async function syncInboxThreads(workspaceId: string, client: SalesBlinkClient, from: number, to: number) {
  let imported = 0;
  for (let skip = 0; skip < 2000; skip += 100) {
    const page = await client.inbox({ from, to, skip, limit: 100 });
    const items = page.result ?? [];
    for (const item of items) {
      if (!item.email) continue;
      const messageKey = `sb:${item.id}`;
      if (await db.message.findUnique({ where: { messageId: messageKey } })) continue;
      const email = item.email.toLowerCase();
      const lead = await db.lead.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
      if (!lead) continue; // only threads for MithMill leads
      const campaign = await db.campaign.findFirst({
        where: { workspaceId, engine: "SALESBLINK", campaignLeads: { some: { leadId: lead.id } } },
        orderBy: { createdAt: "desc" },
      });
      const subject = item.data?.email?.subject ?? null;
      const body = item.data?.email?.body ?? "";
      const text = htmlToText(body);
      const label = await classifyReply(`Subject: ${subject ?? ""}\n\n${stripQuoted(text) || text}`);
      const at = item.scheduled_time ? new Date(item.scheduled_time) : new Date();
      const sender = item.sender
        ? await db.emailAccount.findFirst({ where: { workspaceId, OR: [{ salesblinkSenderId: item.sender }, { emailAddress: item.sender.toLowerCase() }] } })
        : null;

      let thread = await db.thread.findFirst({ where: { workspaceId, leadEmail: email }, orderBy: { lastMessageAt: "desc" } });
      if (!thread) {
        thread = await db.thread.create({ data: { workspaceId, leadId: lead.id, campaignId: campaign?.id, leadEmail: email, subject } });
      }
      await db.message.create({
        data: {
          threadId: thread.id,
          emailAccountId: sender?.id ?? null,
          direction: "INBOUND",
          messageId: messageKey,
          inReplyTo: `${SB_THREAD_PREFIX}${item.messageId}`, // used to reply through SalesBlink
          fromEmail: email,
          toEmail: sender?.emailAddress ?? "",
          subject,
          body,
          receivedAt: at,
        },
      });
      const isReal = label !== "OUT_OF_OFFICE";
      await db.thread.update({
        where: { id: thread.id },
        data: {
          isRead: item.unread === false,
          lastMessageAt: at > thread.lastMessageAt ? at : thread.lastMessageAt,
          summaryStatus: isReal || !thread.summaryStatus ? label : thread.summaryStatus,
          campaignId: thread.campaignId ?? campaign?.id,
        },
      });
      if (isReal) {
        await db.lead.update({ where: { id: lead.id }, data: { status: label === "UNSUBSCRIBE_REQUEST" ? "UNSUBSCRIBED" : "REPLIED" } });
        await emitEvent(workspaceId, "lead.replied", { leadEmail: email, campaignId: campaign?.id, label, subject, text: text.slice(0, 2000) });
        if (campaign && label !== "UNSUBSCRIBE_REQUEST") await enrollSubsequences(campaign.id, lead.id, label);
        if (label === "UNSUBSCRIBE_REQUEST") await client.addToBlocklist([email]).catch(() => undefined);
      }
      imported++;
    }
    if (items.length < 100) break;
  }
  return imported;
}

// ---------------------------------------------------------------------------
// Bounces / unsubscribes (not in the activity feeds): read per-lead sequence status
// ---------------------------------------------------------------------------

export async function syncSequenceLeadStatuses(campaignId: string, client: SalesBlinkClient) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (!c.sbSequenceId) return 0;
  const rows = await client.sequenceLeads(c.sbSequenceId);
  let changed = 0;
  for (const r of rows) {
    const status = (r.status ?? "").toLowerCase();
    if (!/bounce|unsubscrib/.test(status)) continue;
    const lead = await db.lead.findUnique({ where: { workspaceId_email: { workspaceId: c.workspaceId, email: r.email.toLowerCase() } } });
    if (!lead) continue;
    const bounced = status.includes("bounce");
    if (lead.status === (bounced ? "BOUNCED" : "UNSUBSCRIBED")) continue;
    await db.lead.update({ where: { id: lead.id }, data: bounced ? { status: "BOUNCED" } : { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
    await db.campaignLead.updateMany({ where: { leadId: lead.id, status: "ACTIVE" }, data: { status: "FINISHED" } });
    if (bounced) {
      const log = await db.emailLog.findFirst({ where: { campaignId: c.id, leadId: lead.id }, orderBy: { sentAt: "desc" } });
      if (log) await db.emailLog.update({ where: { id: log.id }, data: { status: "BOUNCED", bouncedAt: log.bouncedAt ?? new Date() } });
      await emitEvent(c.workspaceId, "email.bounced", { leadEmail: lead.email, campaignId: c.id });
    } else {
      await emitEvent(c.workspaceId, "lead.unsubscribed", { leadEmail: lead.email, campaignId: c.id });
    }
    changed++;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Periodic sync (worker, every 5 minutes per workspace)
// ---------------------------------------------------------------------------

export async function syncWorkspace(workspaceId: string) {
  const { ws, client } = await workspaceClient(workspaceId);
  const state = (ws.salesblinkSyncState as SyncState | null) ?? {};
  const now = Date.now();
  const initial = now - 7 * 86_400_000;
  const result: Record<string, number> = {};

  // Slow cycle (every 10 min): senders + health, and bounce/unsubscribe status per campaign.
  const slow = !state.sendersAt || now - state.sendersAt > 10 * 60_000;
  if (slow) {
    const r = await syncSenders(workspaceId);
    result.senders = r.senders;
    const active = await db.campaign.findMany({
      where: { workspaceId, engine: "SALESBLINK", sbSequenceId: { not: null }, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true },
    });
    let statusChanges = 0;
    for (const c of active) statusChanges += await syncSequenceLeadStatuses(c.id, client);
    result.statusChanges = statusChanges;
    state.sendersAt = now;
  }

  for (const kind of ["sent", "opens", "clicks", "replies"] as const) {
    const since = state[kind] ?? initial;
    const events = await client.activity(kind, since);
    result[kind] = await applyActivity(workspaceId, kind, events);
    const maxTime = events.reduce((m, e) => Math.max(m, e.time ?? 0), 0);
    state[kind] = maxTime ? maxTime + 1 : since;
  }

  const inboxFrom = state.inbox ?? initial;
  result.inbox = await syncInboxThreads(workspaceId, client, inboxFrom, now);
  state.inbox = now - 5 * 60_000; // small overlap; messages are de-duplicated


  await db.workspace.update({ where: { id: workspaceId }, data: { salesblinkSyncState: state as Prisma.InputJsonValue } });
  return result;
}
