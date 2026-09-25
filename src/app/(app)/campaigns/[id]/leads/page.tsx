import { formatDistanceToNow } from "date-fns";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { Card } from "@/components/ui/card";
import { LeadTable } from "./lead-table";
import { LeadImporter } from "../../../leads/lead-importer";

export default async function CampaignLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const [campaign, rows, total, byStatus] = await Promise.all([
    db.campaign.findFirstOrThrow({ where: { id, workspaceId: workspace.id }, select: { id: true, name: true } }),
    db.campaignLead.findMany({
      where: { campaignId: id },
      include: { lead: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.campaignLead.count({ where: { campaignId: id } }),
    db.campaignLead.groupBy({ by: ["status"], where: { campaignId: id }, _count: true }),
  ]);
  const accounts = new Map(
    (await db.emailAccount.findMany({ where: { workspaceId: workspace.id }, select: { id: true, emailAddress: true } })).map((a) => [a.id, a.emailAddress]),
  );

  return (
    <div className="grid gap-6">
      <LeadImporter campaigns={[campaign]} defaultCampaignId={campaign.id} />
      <Card>
        <div className="flex gap-4 border-b p-4 text-sm">
          <span className="font-medium">{total} leads</span>
          {byStatus.map((s) => (
            <span key={s.status} className="text-muted-foreground">
              {s.status.toLowerCase()}: {s._count}
            </span>
          ))}
        </div>
        <LeadTable
          campaignId={campaign.id}
          rows={rows.map((r) => ({
            id: r.id,
            email: r.lead.email,
            name: [r.lead.firstName, r.lead.lastName].filter(Boolean).join(" "),
            company: r.lead.companyName,
            icebreaker: (r.lead.customVariables as Record<string, string> | null)?.icebreaker ?? null,
            leadStatus: r.lead.status,
            status: r.status,
            step: r.currentStepNumber,
            sender: r.assignedAccountId ? accounts.get(r.assignedAccountId) ?? null : null,
            next: r.status === "ACTIVE" ? (r.nextSendAt ? (r.nextSendAt > new Date() ? `in ${formatDistanceToNow(r.nextSendAt)}` : "due") : "sending…") : "—",
          }))}
        />
        {total > rows.length && <p className="p-3 text-center text-xs text-muted-foreground">Showing the latest {rows.length} of {total}.</p>}
      </Card>
    </div>
  );
}
