import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { campaignStats, dailySeries } from "@/server/services/stats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatTile } from "@/components/stat-tile";
import { ActivityChart } from "@/components/charts/activity-chart";
import { pct } from "@/lib/utils";

export default async function CampaignAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  await db.campaign.findFirstOrThrow({ where: { id, workspaceId: workspace.id } });

  const [stats, series, leadCounts, perStep, perVariant] = await Promise.all([
    campaignStats([id]).then((m) => m.get(id)!),
    dailySeries(workspace.id, 30, id),
    db.campaignLead.groupBy({ by: ["status"], where: { campaignId: id }, _count: true }),
    db.$queryRaw<{ stepNumber: number; sent: number; opened: number; replied: number }[]>`
      SELECT s."stepNumber", count(l.*) FILTER (WHERE l."sentAt" IS NOT NULL)::int AS sent,
             count(l.*) FILTER (WHERE l."openedAt" IS NOT NULL)::int AS opened,
             count(l.*) FILTER (WHERE l."repliedAt" IS NOT NULL)::int AS replied
      FROM "CampaignStep" s LEFT JOIN "EmailLog" l ON l."campaignStepId" = s.id
      WHERE s."campaignId" = ${id}::uuid GROUP BY s."stepNumber" ORDER BY s."stepNumber"`,
    db.$queryRaw<{ stepNumber: number; variant: string; sent: number; opened: number; replied: number }[]>`
      SELECT s."stepNumber", coalesce(l."variantId", 'A') AS variant,
             count(*) FILTER (WHERE l."sentAt" IS NOT NULL)::int AS sent,
             count(*) FILTER (WHERE l."openedAt" IS NOT NULL)::int AS opened,
             count(*) FILTER (WHERE l."repliedAt" IS NOT NULL)::int AS replied
      FROM "EmailLog" l JOIN "CampaignStep" s ON s.id = l."campaignStepId"
      WHERE l."campaignId" = ${id}::uuid GROUP BY 1, 2 ORDER BY 1, 2`,
  ]);
  const totalLeads = leadCounts.reduce((n, r) => n + r._count, 0);
  const finished = leadCounts.find((r) => r.status === "FINISHED")?._count ?? 0;
  const abSteps = new Set(perVariant.filter((v) => v.variant !== "A").map((v) => v.stepNumber));

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Leads" value={totalLeads} sub={`${pct(finished, totalLeads)}% sequence complete`} />
        <StatTile label="Contacted" value={stats.contacted} sub={`${stats.sent} emails sent`} />
        <StatTile label="Open rate" value={`${stats.openRate}%`} sub={`${stats.opened} leads`} />
        <StatTile label="Reply rate" value={`${stats.replyRate}%`} sub={`${stats.replied} leads`} />
        <StatTile label="Positive replies" value={stats.positive} sub="interested + meetings" />
        <StatTile label="Bounce rate" value={`${stats.bounceRate}%`} sub={`${stats.bounced} leads`} />
      </div>
      <Card>
        <CardHeader><CardTitle>Last 30 days</CardTitle></CardHeader>
        <CardContent><ActivityChart data={series} /></CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>By step</CardTitle></CardHeader>
          <Table>
            <THead><tr><th>Step</th><th>Sent</th><th>Opened</th><th>Replied</th></tr></THead>
            <TBody>
              {perStep.map((s) => (
                <tr key={s.stepNumber}>
                  <td>Step {s.stepNumber}</td>
                  <td className="tabular-nums">{s.sent}</td>
                  <td className="tabular-nums">{s.opened} <span className="text-muted-foreground">({pct(s.opened, s.sent)}%)</span></td>
                  <td className="tabular-nums">{s.replied} <span className="text-muted-foreground">({pct(s.replied, s.sent)}%)</span></td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader><CardTitle>A/B tests</CardTitle></CardHeader>
          <Table>
            <THead><tr><th>Step</th><th>Variant</th><th>Sent</th><th>Open rate</th><th>Reply rate</th></tr></THead>
            <TBody>
              {perVariant.filter((v) => abSteps.has(v.stepNumber)).map((v) => (
                <tr key={`${v.stepNumber}-${v.variant}`}>
                  <td>Step {v.stepNumber}</td>
                  <td>{v.variant}</td>
                  <td className="tabular-nums">{v.sent}</td>
                  <td className="tabular-nums">{pct(v.opened, v.sent)}%</td>
                  <td className="tabular-nums">{pct(v.replied, v.sent)}%</td>
                </tr>
              ))}
              {abSteps.size === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground">No A/B variants have been sent yet.</td></tr>}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
