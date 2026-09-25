import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { StatusBadge } from "@/components/status-badge";
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
          </div>
          {campaign.parent && (
            <p className="mt-1 text-sm text-muted-foreground">
              Subsequence of <b>{campaign.parent.name}</b> · triggered by {campaign.triggerLabel?.toLowerCase().replace(/_/g, " ")}
            </p>
          )}
        </div>
        <CampaignControls id={campaign.id} status={campaign.status} />
      </div>
      <CampaignTabs id={campaign.id} />
      <div className="mt-6">{children}</div>
    </>
  );
}
