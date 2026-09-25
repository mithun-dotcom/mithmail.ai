import Link from "next/link";
import { Flame, Plus } from "lucide-react";
import { startOfDay } from "date-fns";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { DnsBadge } from "@/components/dns-badge";
import { StatusBadge } from "@/components/status-badge";

export default async function AccountsPage() {
  const { workspace } = await requireWorkspace();
  const [accounts, sentToday] = await Promise.all([
    db.emailAccount.findMany({
      where: { workspaceId: workspace.id },
      include: { domainHealth: true },
      orderBy: { createdAt: "desc" },
    }),
    db.emailLog.groupBy({
      by: ["emailAccountId"],
      where: { emailAccount: { workspaceId: workspace.id }, sentAt: { gte: startOfDay(new Date()) } },
      _count: true,
    }),
  ]);
  const sentMap = new Map(sentToday.map((s) => [s.emailAccountId, s._count]));
  const totalCapacity = accounts.filter((a) => a.status === "ACTIVE").reduce((n, a) => n + a.dailyLimit, 0);

  return (
    <>
      <PageHeader
        title="Email accounts"
        description={`${accounts.length} / ${workspace.maxInboxes} inboxes · ${totalCapacity.toLocaleString()} emails/day capacity`}
        actions={
          <Link href="/accounts/new" className={buttonVariants()}>
            <Plus /> Add inboxes
          </Link>
        }
      />
      {accounts.length === 0 ? (
        <EmptyState
          title="No inboxes connected"
          description="Connect Google, Microsoft or any SMTP/IMAP inbox. Many inboxes at low volume beat one inbox at high volume."
          action={<Link href="/accounts/new" className={buttonVariants()}>Connect your first inbox</Link>}
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <th>Inbox</th>
                <th>Status</th>
                <th>Sent today</th>
                <th>Warm-up</th>
                <th>DNS</th>
              </tr>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-muted/40">
                  <td>
                    <Link href={`/accounts/${a.id}`} className="font-medium text-royal-800 hover:underline">
                      {a.emailAddress}
                    </Link>
                    <p className="text-xs text-muted-foreground">{a.provider.toLowerCase()}</p>
                  </td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="tabular-nums">
                    {sentMap.get(a.id) ?? 0} / {a.dailyLimit}
                  </td>
                  <td>
                    {a.isWarmupEnabled ? (
                      <span className="inline-flex items-center gap-1 text-sm text-amber-700">
                        <Flame className="h-3.5 w-3.5" /> on
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">off</span>
                    )}
                  </td>
                  <td className="space-x-1">
                    <DnsBadge label="SPF" status={a.domainHealth?.spfStatus} />
                    <DnsBadge label="DKIM" status={a.domainHealth?.dkimStatus} />
                    <DnsBadge label="DMARC" status={a.domainHealth?.dmarcStatus} />
                  </td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
