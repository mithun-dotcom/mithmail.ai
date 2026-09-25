import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { campaignStats } from "@/server/services/stats";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { createCampaign } from "./actions";

export default async function CampaignsPage() {
  const { workspace } = await requireWorkspace();
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { campaignLeads: true, emailAccounts: true } }, parent: { select: { name: true } } },
  });
  const stats = await campaignStats(campaigns.map((c) => c.id));

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Multi-step sequences sent across your inbox pool."
        actions={
          <form action={createCampaign} className="flex gap-2">
            <Input name="name" placeholder="New campaign name" className="w-56" />
            <Button><Plus /> Create</Button>
          </form>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Create a campaign, write (or AI-generate) a sequence, attach inboxes and leads, then launch." />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <th>Campaign</th><th>Status</th><th>Leads</th><th>Inboxes</th><th>Sent</th><th>Opened</th><th>Replied</th><th>Positive</th>
              </tr>
            </THead>
            <TBody>
              {campaigns.map((c) => {
                const s = stats.get(c.id)!;
                return (
                  <tr key={c.id} className="hover:bg-muted/40">
                    <td>
                      <Link href={`/campaigns/${c.id}`} className="font-medium text-royal-800 hover:underline">{c.name}</Link>
                      {c.parent && <p className="text-xs text-muted-foreground">subsequence of {c.parent.name}</p>}
                    </td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="tabular-nums">{c._count.campaignLeads}</td>
                    <td className="tabular-nums">{c._count.emailAccounts}</td>
                    <td className="tabular-nums">{s.sent}</td>
                    <td className="tabular-nums">{s.openRate}%</td>
                    <td className="tabular-nums">{s.replyRate}%</td>
                    <td className="tabular-nums">{s.positive}</td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
