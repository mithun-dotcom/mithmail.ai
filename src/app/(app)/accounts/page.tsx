import Link from "next/link";
import { Flame, Globe, Mail, Plus, Search, Send } from "lucide-react";
import { startOfDay } from "date-fns";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, THead } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { DnsBadge } from "@/components/dns-badge";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { DnsHealthCard } from "@/components/dns-health-card";
import { accountSendingStats, accountWarmupStats, parseRange, RANGES } from "@/server/services/account-stats";
import { SalesblinkSyncButton } from "./sync-button";
import { AccountDrawer, ProviderMark } from "./drawer/drawer";
import { AccountSettings } from "./drawer/account-settings";
import { WarmupSettings } from "./drawer/warmup-settings";
import { AccountActions } from "./drawer/account-actions";
import { accountViewSelect } from "./drawer/types";

type SP = { account?: string; q?: string; range?: string; connected?: string; tab?: string; view?: string };

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const q = sp.q?.trim() ?? "";
  const where: Prisma.EmailAccountWhereInput = {
    workspaceId: workspace.id,
    ...(q ? { OR: [{ emailAddress: { contains: q, mode: "insensitive" } }, { fromName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [accounts, allAccounts, sentToday] = await Promise.all([
    db.emailAccount.findMany({ where, include: { domainHealth: true }, orderBy: { createdAt: "desc" } }),
    db.emailAccount.findMany({ where: { workspaceId: workspace.id }, select: { emailAddress: true, status: true, dailyLimit: true, isWarmupEnabled: true } }),
    db.emailLog.groupBy({
      by: ["emailAccountId"],
      where: { emailAccount: { workspaceId: workspace.id }, sentAt: { gte: startOfDay(new Date()) } },
      _count: true,
    }),
  ]);
  const sentMap = new Map(sentToday.map((s) => [s.emailAccountId, s._count]));
  const sb = workspace.sendingEngine === "SALESBLINK";
  const active = allAccounts.filter((a) => a.status === "ACTIVE");
  const capacity = active.reduce((n, a) => n + a.dailyLimit, 0);
  const domains = new Set(allAccounts.map((a) => domainOf(a.emailAddress))).size;
  const warming = allAccounts.filter((a) => a.isWarmupEnabled).length;

  const withParams = (patch: Partial<SP>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: q || undefined, tab: sp.tab, view: sp.view, range: sp.range, ...patch })) if (v) u.set(k, v);
    return `/accounts?${u.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Email accounts"
        description={`${allAccounts.length} / ${workspace.maxInboxes} inboxes`}
        actions={
          <>
            {sb && <SalesblinkSyncButton />}
            <Link href="/accounts/new" className={buttonVariants()}>
              <Plus /> Add inboxes
            </Link>
          </>
        }
      />
      {allAccounts.length === 0 ? (
        <EmptyState
          title="No inboxes connected"
          description="Connect Google, Microsoft or any SMTP/IMAP inbox. Many inboxes at low volume beat one inbox at high volume."
          action={<Link href="/accounts/new" className={buttonVariants()}>Connect your first inbox</Link>}
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Summary icon={<Mail className="h-4 w-4" />} label="Total accounts" value={allAccounts.length} sub={`${active.length} active`} />
            <Summary icon={<Globe className="h-4 w-4" />} label="Total domains" value={domains} />
            <Summary icon={<Send className="h-4 w-4" />} label="Daily capacity" value={capacity.toLocaleString()} sub="campaign emails / day" />
            <Summary icon={<Flame className="h-4 w-4" />} label="Warm-up on" value={warming} sub={`of ${allAccounts.length} inboxes`} />
          </div>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <p className="text-sm font-medium text-royal-900">
                Your accounts ({accounts.length}
                {q ? ` of ${allAccounts.length}` : ""})
              </p>
              <form action="/accounts" className="relative w-full sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Search by address or name"
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </form>
            </div>
            <Table>
              <THead>
                <tr>
                  <th>Inbox</th>
                  <th>Status</th>
                  <th>Sent today</th>
                  <th>Warm-up</th>
                  {sb && <th>Health</th>}
                  <th>DNS</th>
                </tr>
              </THead>
              <TBody>
                {accounts.map((a) => (
                  <tr key={a.id} className={cn("hover:bg-muted/40", sp.account === a.id && "bg-royal-50")}>
                    <td>
                      <Link href={withParams({ account: a.id })} scroll={false} className="flex items-center gap-2.5">
                        <ProviderMark provider={a.provider} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-royal-800 hover:underline">{a.emailAddress}</span>
                          <span className="block text-xs text-muted-foreground">
                            {a.fromName ?? a.provider.toLowerCase()}
                            {a.salesblinkSenderId && " · via SalesBlink"}
                          </span>
                        </span>
                      </Link>
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
                    {sb && (
                      <td>
                        {a.healthScore === null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Badge variant={a.healthScore >= 80 ? "success" : a.healthScore >= 60 ? "warning" : "danger"}>{a.healthScore}/100</Badge>
                        )}
                      </td>
                    )}
                    <td className="space-x-1 whitespace-nowrap">
                      <DnsBadge label="SPF" status={a.domainHealth?.spfStatus} />
                      <DnsBadge label="DKIM" status={a.domainHealth?.dkimStatus} />
                      <DnsBadge label="DMARC" status={a.domainHealth?.dmarcStatus} />
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={sb ? 6 : 5} className="py-8 text-center text-sm text-muted-foreground">
                      No inboxes match “{q}”.
                    </td>
                  </tr>
                )}
              </TBody>
            </Table>
          </Card>
        </>
      )}
      {sp.account && <Drawer sp={sp} workspaceId={workspace.id} ids={accounts.map((a) => a.id)} />}
    </>
  );
}

async function Drawer({ sp, workspaceId, ids }: { sp: SP; workspaceId: string; ids: string[] }) {
  const account = await db.emailAccount.findFirst({ where: { id: sp.account, workspaceId } });
  if (!account) return null;
  const range = parseRange(sp.range);
  const days = Number(range);
  const [view, domainHealth, trackingDomains, sending, warmup] = await Promise.all([
    db.emailAccount.findUniqueOrThrow({ where: { id: account.id }, select: accountViewSelect }),
    db.domainHealth.findUnique({ where: { emailAccountId: account.id } }),
    db.trackingDomain.findMany({ where: { workspaceId }, select: { id: true, domainName: true, cnameVerified: true } }),
    accountSendingStats(account.id, days),
    accountWarmupStats(account, days),
  ]);
  const i = ids.indexOf(account.id);

  return (
    <AccountDrawer
      account={view}
      prevId={i > 0 ? ids[i - 1] : null}
      nextId={i >= 0 && i < ids.length - 1 ? ids[i + 1] : null}
      range={range}
      ranges={RANGES}
      connected={!!sp.connected}
      sending={sending}
      warmup={warmup}
      accountSettings={<AccountSettings key={account.id} account={view} trackingDomains={trackingDomains} dkimSelector={domainHealth?.dkimSelector ?? null} />}
      warmupSettings={<WarmupSettings key={account.id} account={view} />}
      accountExtras={
        <div className="grid gap-4 lg:grid-cols-2">
          <DnsHealthCard health={domainHealth} />
          <section className="rounded-xl border bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-base font-semibold text-royal-950">Actions</h3>
            <AccountActions id={account.id} status={account.status} />
          </section>
        </div>
      }
    />
  );
}

function Summary({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-royal-100 text-royal-700">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-royal-700">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}
