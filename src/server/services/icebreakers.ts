import { db } from "@/lib/db";
import { generateIcebreaker } from "@/server/ai";
import { getQueue, QUEUES, type IcebreakerJob } from "@/server/queue";

const BATCH = 50;

/** Queues icebreaker generation for a campaign's leads that don't have one yet. */
export async function queueIcebreakers(campaignId: string) {
  const rows = await db.campaignLead.findMany({
    where: { campaignId },
    select: { leadId: true, lead: { select: { customVariables: true } } },
    take: 5000,
  });
  const ids = rows.filter((r) => !(r.lead.customVariables as Record<string, string> | null)?.icebreaker).map((r) => r.leadId);
  const q = getQueue(QUEUES.ai);
  for (let i = 0; i < ids.length; i += BATCH) {
    await q.add("icebreakers", { kind: "icebreakers", campaignId, leadIds: ids.slice(i, i + BATCH) } satisfies IcebreakerJob, {
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
    });
  }
  return ids.length;
}

export async function processIcebreakers(job: IcebreakerJob) {
  const campaign = await db.campaign.findUnique({ where: { id: job.campaignId }, include: { steps: { where: { stepNumber: 1 }, select: { bodySpintax: true } } } });
  const offer = campaign?.steps[0]?.bodySpintax?.slice(0, 600) ?? undefined;
  const leads = await db.lead.findMany({ where: { id: { in: job.leadIds } } });
  let done = 0;
  for (const lead of leads) {
    const vars = (lead.customVariables as Record<string, string> | null) ?? {};
    if (vars.icebreaker) continue;
    const title = vars["Job Title"] ?? vars.title ?? vars.job_title ?? null;
    const line = await generateIcebreaker({ firstName: lead.firstName, companyName: lead.companyName, title, linkedinUrl: lead.linkedinUrl }, offer);
    await db.lead.update({ where: { id: lead.id }, data: { customVariables: { ...vars, icebreaker: line } } });
    done++;
  }
  return { done };
}
