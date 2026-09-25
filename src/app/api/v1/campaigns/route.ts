import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-auth";
import { campaignStats } from "@/server/services/stats";

export const GET = apiHandler(async (_req, ws) => {
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: ws.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true, createdAt: true, parentCampaignId: true, _count: { select: { campaignLeads: true } } },
  });
  const stats = await campaignStats(campaigns.map((c) => c.id));
  return campaigns.map(({ _count, ...c }) => ({ ...c, leads: _count.campaignLeads, stats: stats.get(c.id) }));
});
