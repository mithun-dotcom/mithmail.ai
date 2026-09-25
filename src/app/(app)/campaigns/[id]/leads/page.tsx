import { formatDistanceToNow } from "date-fns";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
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
        <Table>
          <THead>
            <tr><th>Lead</th><th>Lead status</th><th>Sequence</th><th>Step</th><th>Sender</th><th>Next send</th></tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="font-medium">{r.lead.email}</span>
                  <p className="text-xs text-muted-foreground">{[r.lead.firstName, r.lead.lastName].filter(Boolean).join(" ")} {r.lead.companyName && `· ${r.lead.companyName}`}</p>
                </td>
                <td><StatusBadge status={r.lead.status} /></td>
                <td><StatusBadge status={r.status} /></td>
                <td className="tabular-nums">{r.currentStepNumber}</td>
                <td className="text-xs">{r.assignedAccountId ? accounts.get(r.assignedAccountId) : "—"}</td>
                <td className="text-xs text-muted-foreground">
                  {r.status === "ACTIVE" && r.nextSendAt ? (r.nextSendAt > new Date() ? `in ${formatDistanceToNow(r.nextSendAt)}` : "due") : "—"}
                </td>
              </tr>
            ))}
          </TBody>
        </Table>
        {total > rows.length && <p className="p-3 text-center text-xs text-muted-foreground">Showing the latest {rows.length} of {total}.</p>}
      </Card>
    </div>
  );
}
