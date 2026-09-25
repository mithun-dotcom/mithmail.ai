"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { importLeads, type ImportResult, type LeadInput } from "@/server/services/leads";

const leadInput = z.object({
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  companyName: z.string().optional(),
  linkedinUrl: z.string().optional(),
  customVariables: z.record(z.string()).optional(),
});

export async function importLeadsAction(rows: LeadInput[], campaignId?: string): Promise<ImportResult & { error?: string }> {
  const { workspace } = await requireWorkspace("ADMIN");
  const parsed = z.array(leadInput).max(5000).safeParse(rows);
  if (!parsed.success) return { created: 0, updated: 0, invalid: rows.length, blocked: 0, addedToCampaign: 0, error: "Invalid rows" };
  if (campaignId && !(await db.campaign.findFirst({ where: { id: campaignId, workspaceId: workspace.id } }))) {
    return { created: 0, updated: 0, invalid: 0, blocked: 0, addedToCampaign: 0, error: "Campaign not found" };
  }
  const res = await importLeads(workspace.id, parsed.data, campaignId || undefined);
  revalidatePath("/leads");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  return res;
}

export async function deleteLeads(ids: string[]) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.lead.deleteMany({ where: { id: { in: ids }, workspaceId: workspace.id } });
  revalidatePath("/leads");
}

export async function addLeadsToCampaign(ids: string[], campaignId: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId, workspaceId: workspace.id } });
  const leads = await db.lead.findMany({
    where: { id: { in: ids }, workspaceId: workspace.id, status: { notIn: ["UNSUBSCRIBED", "BOUNCED"] } },
    select: { id: true },
  });
  const res = await db.campaignLead.createMany({ data: leads.map((l) => ({ campaignId: campaign.id, leadId: l.id })), skipDuplicates: true });
  revalidatePath(`/campaigns/${campaignId}`);
  return res.count;
}
