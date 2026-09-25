import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { pct } from "@/lib/utils";
import { requireWorkspace } from "@/server/workspace";
import { campaignStats, dailySeries } from "@/server/services/stats";
import { startOfUtcDay } from "@/server/sending/scheduler";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { RatesLineChart, SentBarChart } from "@/components/charts/dashboard-charts";

export default async function DashboardPage() {
  const { workspace } = await requireWorkspace();
  const [series, campaigns, accounts, sentToday, unreadPositive] = await Promise.all([
    dailySeries(workspace.id, 30),
    db.campaign.findMany({ where: { workspaceId: workspace.id, status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } }, select: { id: true, name: true, status: true } }),
    db.emailAccount.findMany({ where: { workspaceId: workspace.id }, include: { domainHealth: true } }),
    db.emailLog.count({ where: { campaign: { workspaceId: workspace.id }, sentAt: { gte: startOfUtcDay() } } }),
    db.thread.count({ where: { workspaceId: workspace.id, isRead: false, summaryStatus: { in: ["INTERESTED", "MEETING_BOOKED"] } } }),
  ]);
  const stats = await campaignStats(campaigns.map((c) => c.id));

  const last7 = series.slice(-7);
  const sum = (k: "sent" | "opened" | "replied" | "bounced") => last7.reduce((n, d) => n + d[k], 0);
  const capacity = accounts.filter((a) => a.status === "ACTIVE").reduce((n, a) => n + a.dailyLimit, 0);
  const positives = [...stats.values()].reduce((n, s) => n + s.positive, 0);
  const attention = accounts.filter(
    (a) => a.status === "ERROR" || a.lastError || [a.domainHealth?.spfStatus, a.domainHealth?.dkimStatus, a.domainHealth?.dmarcStatus].some((s) => s === "MISSING" || s === "INVALID"),
  );
  const top = campaigns
    .map((c) => ({ ...c, s: stats.get(c.id)! }))
    .sort((a, b) => b.s.sent - a.s.sent)
    .slice(0, 6);

  return (
    <>
      <PageHeader title="Dashboard" description={`${workspace.name} · last 30 days`} />
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Sent today" value={sentToday.toLocaleString()} sub={`of ${capacity.toLocaleString()} capacity`} />
          <StatTile label="Sent (7d)" value={sum("sent").toLocaleString()} />
          <StatTile label="Open rate (7d)" value={`${pct(sum("opened"), sum("sent"))}%`} />
          <StatTile label="Reply rate (7d)" value={`${pct(sum("replied"), sum("sent"))}%`} />
          <StatTile label="Positive replies" value={positives} sub={unreadPositive ? `${unreadPositive} unread` : "all caught up"} />
          <StatTile label="Bounce rate (7d)" value={`${pct(sum("bounced"), sum("sent"))}%`} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Emails sent per day</CardTitle></CardHeader>
            <CardContent><SentBarChart data={series} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Open & reply rate</CardTitle><CardDescription>Share of each day&apos;s sends that were opened / replied to.</CardDescription></CardHeader>
            <CardContent><RatesLineChart data={series} /></CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Campaigns</CardTitle></CardHeader>
            <Table>
              <THead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Open</th><th>Reply</th><th>Positive</th></tr></THead>
              <TBody>
                {top.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/campaigns/${c.id}`} className="font-medium text-royal-800 hover:underline">{c.name}</Link></td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="tabular-nums">{c.s.sent}</td>
                    <td className="tabular-nums">{c.s.openRate}%</td>
                    <td className="tabular-nums">{c.s.replyRate}%</td>
                    <td className="tabular-nums">{c.s.positive}</td>
                  </tr>
                ))}
                {top.length === 0 && <tr><td colSpan={6} className="text-center text-muted-foreground">No launched campaigns yet.</td></tr>}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>{accounts.length} inboxes connected</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {attention.slice(0, 8).map((a) => (
                <Link key={a.id} href={`/accounts/${a.id}`} className="flex items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.emailAddress}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.lastError ?? "DNS authentication incomplete"}</span>
                  </span>
                </Link>
              ))}
              {attention.length === 0 && <p className="text-sm text-muted-foreground">All inboxes healthy.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
