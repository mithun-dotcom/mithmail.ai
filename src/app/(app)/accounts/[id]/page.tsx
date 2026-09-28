import { notFound } from "next/navigation";
import { startOfDay, subDays } from "date-fns";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { DnsHealthCard } from "@/components/dns-health-card";
import { SettingsForm } from "./settings-form";
import { AccountActions } from "./account-actions";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const account = await db.emailAccount.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { domainHealth: true },
  });
  if (!account) notFound();

  const since = subDays(startOfDay(new Date()), 6);
  const [trackingDomains, sent7d, bounced7d, warmSent, warmSpam] = await Promise.all([
    db.trackingDomain.findMany({ where: { workspaceId: workspace.id } }),
    db.emailLog.count({ where: { emailAccountId: id, sentAt: { gte: since } } }),
    db.emailLog.count({ where: { emailAccountId: id, status: "BOUNCED", sentAt: { gte: since } } }),
    db.warmupLog.count({ where: { senderAccountId: id, sentAt: { gte: since } } }),
    db.warmupLog.count({ where: { senderAccountId: id, sentAt: { gte: since }, landedInSpam: true } }),
  ]);
  const sbStats = account.externalStats as { last7Days?: { sent: number; bounced: number; replies: number }; warmup30Days?: { sent: number; replies: number } } | null;
  const warmupHealth = warmSent ? Math.round(((warmSent - warmSpam) / warmSent) * 100) : null;

  return (
    <>
      <PageHeader title={account.emailAddress} description={`${account.provider.toLowerCase()} · added ${account.createdAt.toDateString()}`} actions={<StatusBadge status={account.status} />} />
      {account.lastError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{account.lastError}</p>}
      {account.salesblinkSenderId && (
        <p className="mb-4 rounded-md bg-royal-50 px-3 py-2 text-sm text-royal-900">
          Managed by SalesBlink — sending, warm-up and reply detection run there. Limits and warm-up settings you save here are pushed to SalesBlink.
          {sbStats && (
            <>
              {" "}Health <b>{account.healthScore ?? "—"}/100</b> · last 7 days {sbStats.last7Days?.sent ?? 0} sent, {sbStats.last7Days?.bounced ?? 0} bounced, {sbStats.last7Days?.replies ?? 0} replies · warm-up (30d) {sbStats.warmup30Days?.sent ?? 0} sent, {sbStats.warmup30Days?.replies ?? 0} replies.
            </>
          )}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingsForm account={account} trackingDomains={trackingDomains} dkimSelector={account.domainHealth?.dkimSelector ?? null} />
            </CardContent>
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Last 7 days</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Sent" value={sent7d} />
              <Stat label="Bounced" value={bounced7d} />
              <Stat label="Warm-up health" value={warmupHealth === null ? "—" : `${warmupHealth}%`} />
            </CardContent>
          </Card>
          <DnsHealthCard health={account.domainHealth} />
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <AccountActions id={account.id} status={account.status} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-royal-900">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
