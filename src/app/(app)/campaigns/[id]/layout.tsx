import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { CampaignTabs } from "./tabs";
import { CampaignControls } from "./controls";

export default async function CampaignLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const campaign = await db.campaign.findFirst({ where: { id, workspaceId: workspace.id }, include: { parent: { select: { name: true } } } });
  if (!campaign) notFound();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-royal-950">{campaign.name}</h1>
            <StatusBadge status={campaign.status} />
            {campaign.engine === "SALESBLINK" && <Badge variant="warning">via SalesBlink</Badge>}
          </div>
          {campaign.parent && (
            <p className="mt-1 text-sm text-muted-foreground">
              Subsequence of <b>{campaign.parent.name}</b> · triggered by {campaign.triggerLabel?.toLowerCase().replace(/_/g, " ")}
            </p>
          )}
        </div>
        <CampaignControls id={campaign.id} status={campaign.status} />
      </div>
      {campaign.sbLaunchState === "LAUNCHING" && (
        <p className="mb-4 rounded-md bg-royal-50 px-3 py-2 text-sm text-royal-900">
          Launching on SalesBlink: creating the list, pushing personalised emails for each lead, creating templates and the sequence. Refresh in a minute.
        </p>
      )}
      {campaign.sbLaunchState === "ERROR" && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          SalesBlink launch failed: {campaign.sbLaunchError}. Fix the issue and click Launch again — it resumes where it stopped.
        </p>
      )}
      <CampaignTabs id={campaign.id} />
      <div className="mt-6">{children}</div>
    </>
  );
}
