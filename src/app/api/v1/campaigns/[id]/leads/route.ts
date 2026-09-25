import { db } from "@/lib/db";
import { ApiError, apiHandler } from "@/server/api-auth";
import { importLeads } from "@/server/services/leads";
import { apiLeadBatch } from "../../../leads/schema";

export const POST = apiHandler(async (req, ws, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const campaign = await db.campaign.findFirst({ where: { id, workspaceId: ws.id } });
  if (!campaign) throw new ApiError(404, "Campaign not found");
  const body = apiLeadBatch.omit({ campaignId: true }).parse(await req.json());
  return importLeads(ws.id, body.leads, campaign.id);
});
