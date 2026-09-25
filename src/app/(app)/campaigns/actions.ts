"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { aiEnabled, generateSequence, type GeneratedStep } from "@/server/ai";
import { queueIcebreakers } from "@/server/services/icebreakers";
import { scheduleSchema, stepSchema, type ScheduleDraft, type StepDraft } from "@/lib/campaign-types";

export type Result = { ok?: boolean; error?: string; message?: string };

async function ownCampaign(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  const campaign = await db.campaign.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!campaign) throw new Error("Campaign not found");
  return { campaign, workspace };
}

export async function createCampaign(formData: FormData) {
  const { workspace } = await requireWorkspace("ADMIN");
  const name = z.string().trim().min(1).max(120).parse(formData.get("name") || "Untitled campaign");
  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      name,
      schedule: { create: { daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" } },
      steps: { create: { stepNumber: 1, waitDays: 0, subject: "", bodySpintax: "" } },
    },
  });
  redirect(`/campaigns/${campaign.id}/sequence`);
}

export async function renameCampaign(id: string, name: string): Promise<Result> {
  await ownCampaign(id);
  await db.campaign.update({ where: { id }, data: { name: z.string().trim().min(1).max(120).parse(name) } });
  revalidatePath(`/campaigns/${id}`);
  return { ok: true };
}

export async function saveSequence(id: string, steps: StepDraft[]): Promise<Result> {
  await ownCampaign(id);
  const parsed = z.array(stepSchema).min(1).max(15).safeParse(steps.map((s, i) => ({ ...s, stepNumber: i + 1 })));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid sequence" };

  await db.$transaction(async (tx) => {
    await tx.campaignStep.deleteMany({ where: { campaignId: id, stepNumber: { gt: parsed.data.length } } });
    for (const s of parsed.data) {
      const data = {
        waitDays: s.stepNumber === 1 ? 0 : s.waitDays,
        subject: s.subject,
        bodySpintax: s.body,
        bodyHtml: null,
        abTestVariants: s.variants.length ? (s.variants as Prisma.InputJsonValue) : Prisma.DbNull,
      };
      await tx.campaignStep.upsert({
        where: { campaignId_stepNumber: { campaignId: id, stepNumber: s.stepNumber } },
        create: { campaignId: id, stepNumber: s.stepNumber, ...data },
        update: data,
      });
    }
  });
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: "Sequence saved." };
}

export async function aiWriteSequence(brief: { prompt: string; steps: number; tone?: string; useSpintax: boolean }): Promise<{ steps?: GeneratedStep[]; error?: string }> {
  await requireWorkspace("ADMIN");
  if (brief.prompt.trim().length < 15) return { error: "Describe your offer and audience in a sentence or two." };
  try {
    return { steps: await generateSequence(brief) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveSchedule(id: string, schedule: ScheduleDraft): Promise<Result> {
  await ownCampaign(id);
  const p = scheduleSchema.safeParse(schedule);
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (p.data.endTime <= p.data.startTime) return { error: "End time must be after start time." };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: p.data.timezone });
  } catch {
    return { error: "Unknown timezone" };
  }
  await db.campaign.update({
    where: { id },
    data: {
      scheduleTimezone: p.data.timezone,
      schedule: {
        upsert: {
          create: { daysOfWeek: p.data.daysOfWeek, startTime: p.data.startTime, endTime: p.data.endTime },
          update: { daysOfWeek: p.data.daysOfWeek, startTime: p.data.startTime, endTime: p.data.endTime },
        },
      },
    },
  });
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: "Schedule saved." };
}

const optionsSchema = z.object({
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  stopOnReply: z.boolean(),
  espMatching: z.boolean(),
  includeUnsubscribe: z.boolean(),
  sendAsPlainText: z.boolean(),
  dailyLeadLimit: z.number().int().min(1).max(100000).nullable(),
  emailAccountIds: z.array(z.string().uuid()),
});

export async function saveOptions(id: string, input: z.infer<typeof optionsSchema>): Promise<Result> {
  const { workspace } = await ownCampaign(id);
  const p = optionsSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { emailAccountIds, ...opts } = p.data;
  const accounts = await db.emailAccount.findMany({ where: { id: { in: emailAccountIds }, workspaceId: workspace.id }, select: { id: true } });
  await db.$transaction([
    db.campaign.update({ where: { id }, data: opts }),
    db.campaignEmailAccount.deleteMany({ where: { campaignId: id } }),
    db.campaignEmailAccount.createMany({ data: accounts.map((a) => ({ campaignId: id, emailAccountId: a.id })) }),
  ]);
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: "Settings saved." };
}

/** Validates the campaign is ready, then flips it to ACTIVE. The scheduler picks it up on its next tick. */
export async function launchCampaign(id: string): Promise<Result> {
  await ownCampaign(id);
  const c = await db.campaign.findUniqueOrThrow({
    where: { id },
    include: { steps: true, schedule: true, _count: { select: { campaignLeads: true, emailAccounts: true } } },
  });
  const problems: string[] = [];
  const first = c.steps.find((s) => s.stepNumber === 1);
  if (!first?.subject?.trim()) problems.push("Step 1 needs a subject.");
  if (c.steps.some((s) => !s.bodySpintax?.trim() && !s.bodyHtml?.trim())) problems.push("Every step needs a body.");
  if (!c.schedule || c.schedule.daysOfWeek.length === 0) problems.push("Set a sending schedule.");
  if (c._count.emailAccounts === 0) problems.push("Attach at least one sending inbox.");
  if (c._count.campaignLeads === 0) problems.push("Add leads.");
  if (problems.length) return { error: problems.join(" ") };

  await db.campaign.update({ where: { id }, data: { status: "ACTIVE" } });
  // Leads that have never been scheduled become due immediately (the scheduler applies the send window).
  await db.campaignLead.updateMany({ where: { campaignId: id, status: "ACTIVE", nextSendAt: null, currentStepNumber: 0 }, data: { nextSendAt: new Date() } });
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true, message: "Campaign launched." };
}

export async function pauseCampaign(id: string): Promise<Result> {
  await ownCampaign(id);
  await db.campaign.update({ where: { id }, data: { status: "PAUSED" } });
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true, message: "Campaign paused." };
}

export async function duplicateCampaign(id: string) {
  const { campaign, workspace } = await ownCampaign(id);
  const full = await db.campaign.findUniqueOrThrow({ where: { id }, include: { steps: true, schedule: true, emailAccounts: true } });
  const copy = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      name: `${campaign.name} (copy)`,
      trackOpens: full.trackOpens,
      trackClicks: full.trackClicks,
      scheduleTimezone: full.scheduleTimezone,
      stopOnReply: full.stopOnReply,
      espMatching: full.espMatching,
      includeUnsubscribe: full.includeUnsubscribe,
      sendAsPlainText: full.sendAsPlainText,
      dailyLeadLimit: full.dailyLeadLimit,
      schedule: full.schedule
        ? { create: { daysOfWeek: full.schedule.daysOfWeek, startTime: full.schedule.startTime, endTime: full.schedule.endTime } }
        : undefined,
      steps: {
        create: full.steps.map((s) => ({
          stepNumber: s.stepNumber,
          type: s.type,
          waitDays: s.waitDays,
          subject: s.subject,
          bodyHtml: s.bodyHtml,
          bodySpintax: s.bodySpintax,
          abTestVariants: s.abTestVariants ?? undefined,
        })),
      },
      emailAccounts: { create: full.emailAccounts.map((a) => ({ emailAccountId: a.emailAccountId })) },
    },
  });
  redirect(`/campaigns/${copy.id}/sequence`);
}

export async function deleteCampaign(id: string) {
  await ownCampaign(id);
  await db.campaign.delete({ where: { id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export async function removeCampaignLeads(id: string, campaignLeadIds: string[]): Promise<Result> {
  await ownCampaign(id);
  await db.campaignLead.deleteMany({ where: { campaignId: id, id: { in: campaignLeadIds } } });
  revalidatePath(`/campaigns/${id}/leads`);
  return { ok: true };
}

export async function setSubsequence(id: string, parentCampaignId: string | null, triggerLabel: string | null): Promise<Result> {
  const { workspace } = await ownCampaign(id);
  if (parentCampaignId) {
    if (parentCampaignId === id) return { error: "A campaign cannot be its own subsequence." };
    await db.campaign.findFirstOrThrow({ where: { id: parentCampaignId, workspaceId: workspace.id } });
  }
  const label = triggerLabel ? z.enum(["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "NEUTRAL"]).parse(triggerLabel) : null;
  await db.campaign.update({ where: { id }, data: { parentCampaignId, triggerLabel: parentCampaignId ? label : null } });
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: "Subsequence saved." };
}

export async function generateIcebreakersAction(id: string): Promise<Result> {
  await ownCampaign(id);
  if (!aiEnabled()) return { error: "Set OPENAI_API_KEY to enable AI icebreakers." };
  const n = await queueIcebreakers(id);
  return { ok: true, message: n ? `Generating icebreakers for ${n} leads in the background. Use {{icebreaker}} in your sequence.` : "Every lead already has an icebreaker." };
}

export async function setCampaignLeadStatus(id: string, campaignLeadIds: string[], status: "ACTIVE" | "PAUSED"): Promise<Result> {
  await ownCampaign(id);
  await db.campaignLead.updateMany({
    where: { campaignId: id, id: { in: campaignLeadIds }, status: status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
    data: status === "ACTIVE" ? { status, nextSendAt: new Date() } : { status, nextSendAt: null },
  });
  revalidatePath(`/campaigns/${id}/leads`);
  return { ok: true };
}
