import { Prisma, type CampaignLead, type EmailAccount, type Lead, type LeadEsp } from "@prisma/client";
import { db } from "@/lib/db";
import { isWithinWindow, randomBetween } from "@/lib/schedule";
import { getQueue, QUEUES, redis, type SendEmailJob } from "@/server/queue";
import { emitEvent } from "@/server/services/webhooks";

const PACE_KEY = (accountId: string) => `mm:pace:${accountId}`;

export function startOfUtcDay(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export function espMatches(account: Pick<EmailAccount, "provider">, esp: LeadEsp) {
  return (account.provider === "GOOGLE" && esp === "GOOGLE") || (account.provider === "MICROSOFT" && esp === "MICROSOFT");
}

/**
 * Greedy inbox assignment for new leads. With ESP matching on, a lead goes to a
 * same-provider inbox when one is free, otherwise to any free inbox. Each inbox
 * takes at most one lead per tick.
 */
export function assignLeads<L extends { id: string; lead: Pick<Lead, "esp"> }, A extends Pick<EmailAccount, "id" | "provider">>(
  leads: L[],
  accounts: A[],
  espMatching: boolean,
): { lead: L; account: A }[] {
  const free = [...accounts];
  const out: { lead: L; account: A }[] = [];
  const pending = [...leads];
  if (espMatching) {
    for (let i = 0; i < pending.length && free.length; ) {
      const idx = free.findIndex((a) => espMatches(a, pending[i].lead.esp));
      if (idx >= 0) {
        out.push({ lead: pending[i], account: free[idx] });
        free.splice(idx, 1);
        pending.splice(i, 1);
      } else i++;
    }
  }
  for (const l of pending) {
    const a = free.shift();
    if (!a) break;
    out.push({ lead: l, account: a });
  }
  return out;
}

interface AccountState {
  account: EmailAccount;
  remaining: number;
}

/**
 * Self-healing: releases leads stuck "in flight" — e.g. the process died between
 * claiming a lead and queueing its job, or Redis lost the job.
 */
export async function reapStuck(now = new Date()) {
  const staleQueued = new Date(now.getTime() - 2 * 3600_000);
  const lost = await db.emailLog.findMany({
    where: { status: "QUEUED", createdAt: { lt: staleQueued } },
    select: { id: true, campaignId: true, leadId: true },
    take: 500,
  });
  if (lost.length) {
    const q = getQueue(QUEUES.sendEmail);
    for (const l of lost) {
      const job = await q.getJob(l.id);
      const state = job ? await job.getState() : "missing";
      if (state === "active" || state === "waiting" || state === "delayed") continue;
      await db.emailLog.update({ where: { id: l.id }, data: { status: "FAILED", errorMessage: `Job ${state}; released by reaper` } });
      await db.campaignLead.updateMany({ where: { campaignId: l.campaignId, leadId: l.leadId, status: "ACTIVE", nextSendAt: null }, data: { nextSendAt: now } });
    }
  }
  const released = await db.$executeRaw`
    UPDATE "CampaignLead" cl SET "nextSendAt" = ${now}
    WHERE cl.status = 'ACTIVE' AND cl."nextSendAt" IS NULL AND cl."updatedAt" < ${new Date(now.getTime() - 15 * 60_000)}
      AND NOT EXISTS (SELECT 1 FROM "EmailLog" l WHERE l."campaignId" = cl."campaignId" AND l."leadId" = cl."leadId" AND l.status = 'QUEUED')`;
  return { lost: lost.length, released };
}

/** One pass over all active campaigns. Returns the number of emails queued. */
export async function runSchedulerTick(now = new Date()): Promise<{ queued: number; completed: number }> {
  if (now.getUTCMinutes() % 10 === 0) await reapStuck(now).catch((e) => console.error("reaper failed", e));
  const r = await redis();
  const dayStart = startOfUtcDay(now);
  const campaigns = await db.campaign.findMany({
    where: { status: "ACTIVE" },
    include: {
      schedule: true,
      steps: { orderBy: { stepNumber: "asc" }, select: { id: true, stepNumber: true } },
      emailAccounts: { include: { emailAccount: true } },
    },
  });

  // Per-inbox remaining capacity today (sent + in-flight count against the limit).
  const accountIds = [...new Set(campaigns.flatMap((c) => c.emailAccounts.map((e) => e.emailAccountId)))];
  const usage = accountIds.length
    ? await db.emailLog.groupBy({
        by: ["emailAccountId"],
        where: { emailAccountId: { in: accountIds }, OR: [{ sentAt: { gte: dayStart } }, { status: "QUEUED" }] },
        _count: true,
      })
    : [];
  const used = new Map(usage.map((u) => [u.emailAccountId, u._count]));
  const paceValues = accountIds.length ? await r.mget(accountIds.map(PACE_KEY)) : [];
  const pace = new Map(accountIds.map((id, i) => [id, Number(paceValues[i] ?? 0)]));
  const busy = new Set<string>(); // inboxes already given a send this tick

  // Monthly plan quota per workspace (sent + in flight this calendar month, UTC).
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const workspaceIds = [...new Set(campaigns.map((c) => c.workspaceId))];
  const [workspaces, monthUsage] = workspaceIds.length
    ? await Promise.all([
        db.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, monthlyEmailQuota: true } }),
        db.$queryRaw<{ workspaceId: string; n: number }[]>`
          SELECT c."workspaceId", count(*)::int AS n FROM "EmailLog" l JOIN "Campaign" c ON c.id = l."campaignId"
          WHERE c."workspaceId" IN (${Prisma.join(workspaceIds.map((id) => Prisma.sql`${id}::uuid`))})
            AND (l."sentAt" >= ${monthStart} OR l.status = 'QUEUED')
          GROUP BY 1`,
      ])
    : [[], []];
  const quotaLeft = new Map(workspaces.map((w) => [w.id, w.monthlyEmailQuota - (monthUsage.find((u) => u.workspaceId === w.id)?.n ?? 0)]));

  let queued = 0;
  let completed = 0;
  const sendQueue = getQueue(QUEUES.sendEmail);

  for (const c of campaigns) {
    if (!c.schedule || !isWithinWindow(now, c.scheduleTimezone, c.schedule)) continue;
    if ((quotaLeft.get(c.workspaceId) ?? 0) <= 0) continue;
    if (c.steps.length === 0) continue;

    const states: AccountState[] = c.emailAccounts
      .map((e) => e.emailAccount)
      .filter((a) => a.status === "ACTIVE")
      .map((a) => ({ account: a, remaining: a.dailyLimit - (used.get(a.id) ?? 0) }));
    const poolIds = new Set(states.map((s) => s.account.id));
    const free = states.filter((s) => s.remaining > 0 && !busy.has(s.account.id) && (pace.get(s.account.id) ?? 0) <= now.getTime());

    // stop-on-reply is enforced by pausing the CampaignLead when the reply is detected,
    // so replied leads can still be enrolled into subsequences.
    const baseWhere = {
      campaignId: c.id,
      status: "ACTIVE" as const,
      nextSendAt: { lte: now },
      lead: { status: { notIn: ["BOUNCED" as const, "UNSUBSCRIBED" as const] } },
    };

    const picks: { cl: CampaignLead & { lead: Lead }; account: EmailAccount }[] = [];

    if (free.length) {
      const freeIds = free.map((s) => s.account.id);
      // 1) Follow-ups stay on the inbox that started the thread.
      const followUps = await db.campaignLead.findMany({
        where: { ...baseWhere, currentStepNumber: { gt: 0 }, assignedAccountId: { in: freeIds } },
        include: { lead: true },
        orderBy: { nextSendAt: "asc" },
        take: freeIds.length * 4,
      });
      const taken = new Set<string>();
      for (const cl of followUps) {
        if (taken.has(cl.assignedAccountId!)) continue;
        taken.add(cl.assignedAccountId!);
        picks.push({ cl, account: free.find((s) => s.account.id === cl.assignedAccountId)!.account });
      }

      // 2) New leads (and orphaned follow-ups whose inbox left the pool) round-robin across the rest.
      const remainingFree = free.filter((s) => !taken.has(s.account.id)).map((s) => s.account);
      if (remainingFree.length) {
        let newBudget = remainingFree.length;
        if (c.dailyLeadLimit) {
          const startedToday = await db.emailLog.count({
            where: { campaignId: c.id, campaignStep: { stepNumber: 1 }, OR: [{ sentAt: { gte: dayStart } }, { status: "QUEUED" }] },
          });
          newBudget = Math.max(0, Math.min(newBudget, c.dailyLeadLimit - startedToday));
        }
        const orphans = await db.campaignLead.findMany({
          where: { ...baseWhere, currentStepNumber: { gt: 0 }, OR: [{ assignedAccountId: null }, { assignedAccountId: { notIn: [...poolIds] } }] },
          include: { lead: true },
          orderBy: { nextSendAt: "asc" },
          take: remainingFree.length,
        });
        const fresh = newBudget
          ? await db.campaignLead.findMany({
              where: { ...baseWhere, currentStepNumber: 0 },
              include: { lead: true },
              orderBy: { createdAt: "asc" },
              take: newBudget * 3, // over-fetch so ESP matching has choices
            })
          : [];
        const candidates = [...orphans, ...fresh.slice(0, Math.max(0, newBudget * 3))];
        const assigned = assignLeads(candidates, remainingFree, c.espMatching);
        let newCount = 0;
        for (const { lead: cl, account } of assigned) {
          if (cl.currentStepNumber === 0) {
            if (newCount >= newBudget) continue;
            newCount++;
          }
          picks.push({ cl, account });
        }
      }
    }

    for (const { cl, account } of picks) {
      if ((quotaLeft.get(c.workspaceId) ?? 0) <= 0) break;
      const nextStep = c.steps.find((s) => s.stepNumber === cl.currentStepNumber + 1);
      if (!nextStep) {
        await db.campaignLead.update({ where: { id: cl.id }, data: { status: "FINISHED", nextSendAt: null } });
        continue;
      }
      // Claim atomically: only one scheduler can null out nextSendAt.
      const claimed = await db.campaignLead.updateMany({
        where: { id: cl.id, nextSendAt: { not: null }, status: "ACTIVE" },
        data: { nextSendAt: null, assignedAccountId: account.id },
      });
      if (claimed.count === 0) continue;

      const log = await db.emailLog.create({
        data: { campaignId: c.id, campaignStepId: nextStep.id, leadId: cl.leadId, emailAccountId: account.id, status: "QUEUED" },
      });
      const gapMs = randomBetween(account.minDelaySeconds, account.maxDelaySeconds) * 1000;
      const jitterMs = Math.floor(Math.random() * 30_000); // spread sends inside the minute
      await sendQueue.add("send", { emailLogId: log.id } satisfies SendEmailJob, {
        jobId: log.id,
        delay: jitterMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
      });
      await r.set(PACE_KEY(account.id), String(now.getTime() + jitterMs + gapMs), "PX", 24 * 3600 * 1000);
      busy.add(account.id);
      quotaLeft.set(c.workspaceId, (quotaLeft.get(c.workspaceId) ?? 0) - 1);
      used.set(account.id, (used.get(account.id) ?? 0) + 1);
      queued++;
    }

    // Completion: nothing left to send and nothing in flight.
    const [activeLeft, inFlight] = await Promise.all([
      db.campaignLead.count({ where: { campaignId: c.id, status: "ACTIVE" } }),
      db.emailLog.count({ where: { campaignId: c.id, status: "QUEUED" } }),
    ]);
    if (activeLeft === 0 && inFlight === 0) {
      await db.campaign.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
      await emitEvent(c.workspaceId, "campaign.completed", { campaignId: c.id, name: c.name });
      completed++;
    }
  }
  return { queued, completed };
}
