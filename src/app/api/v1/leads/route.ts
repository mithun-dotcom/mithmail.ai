import { db } from "@/lib/db";
import { ApiError, apiHandler } from "@/server/api-auth";
import { importLeads } from "@/server/services/leads";
import { apiLeadBatch } from "./schema";

export const GET = apiHandler(async (req, ws) => {
  const email = new URL(req.url).searchParams.get("email")?.toLowerCase().trim();
  if (!email) throw new ApiError(400, "email query parameter is required");
  const lead = await db.lead.findUnique({
    where: { workspaceId_email: { workspaceId: ws.id, email } },
    include: { campaignLeads: { select: { campaignId: true, status: true, currentStepNumber: true } } },
  });
  if (!lead) throw new ApiError(404, "Lead not found");
  return lead;
});

export const POST = apiHandler(async (req, ws) => {
  const body = apiLeadBatch.parse(await req.json());
  if (body.campaignId && !(await db.campaign.findFirst({ where: { id: body.campaignId, workspaceId: ws.id } }))) {
    throw new ApiError(404, "Campaign not found");
  }
  return importLeads(ws.id, body.leads, body.campaignId);
});
