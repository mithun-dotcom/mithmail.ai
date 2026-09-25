import Link from "next/link";
import { subDays } from "date-fns";
import { Flame } from "lucide-react";
import { db } from "@/lib/db";
import { pct } from "@/lib/utils";
import { requireWorkspace } from "@/server/workspace";
import { dailyWarmupTarget } from "@/server/warmup/engine";
import { startOfUtcDay } from "@/server/sending/scheduler";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead } from "@/components/ui/table";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { setWarmupForAll, toggleWarmup } from "./actions";

export default async function WarmupPage() {
  const { workspace } = await requireWorkspace();
  const since = subDays(new Date(), 14);
  const accounts = await db.emailAccount.findMany({ where: { workspaceId: workspace.id }, orderBy: { emailAddress: "asc" } });
  const ids = accounts.map((a) => a.id);
  const [sent14, spam14, received14, replied14, sentToday] = await Promise.all([
    db.warmupLog.groupBy({ by: ["senderAccountId"], where: { senderAccountId: { in: ids }, sentAt: { gte: since } }, _count: true }),
    db.warmupLog.groupBy({ by: ["senderAccountId"], where: { senderAccountId: { in: ids }, sentAt: { gte: since }, landedInSpam: true }, _count: true }),
    db.warmupLog.groupBy({ by: ["recipientAccountId"], where: { recipientAccountId: { in: ids }, sentAt: { gte: since } }, _count: true }),
    db.warmupLog.groupBy({ by: ["senderAccountId"], where: { senderAccountId: { in: ids }, sentAt: { gte: since }, status: "REPLIED" }, _count: true }),
    db.warmupLog.groupBy({ by: ["senderAccountId"], where: { senderAccountId: { in: ids }, sentAt: { gte: startOfUtcDay() } }, _count: true }),
  ]);
  const m = (rows: { _count: number; senderAccountId?: string; recipientAccountId?: string }[]) =>
    new Map(rows.map((r) => [r.senderAccountId ?? r.recipientAccountId ?? "", r._count]));
  const [S, SP, R, RP, T] = [m(sent14), m(spam14), m(received14), m(replied14), m(sentToday)];
  const totalSent = [...S.values()].reduce((a, b) => a + b, 0);
  const totalSpam = [...SP.values()].reduce((a, b) => a + b, 0);
  const enabled = accounts.filter((a) => a.isWarmupEnabled).length;
  const networkSize = await db.emailAccount.count({ where: { isWarmupEnabled: true, status: "ACTIVE" } });

  return (
    <>
      <PageHeader
        title="Warm-up"
        description="Inboxes exchange natural conversations across the MithMill network. Spam placements are rescued, marked important and replied to."
        actions={
          <>
            <form action={setWarmupForAll.bind(null, true)}><Button variant="gold"><Flame /> Enable all</Button></form>
            <form action={setWarmupForAll.bind(null, false)}><Button variant="outline">Disable all</Button></form>
          </>
        }
      />
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Inboxes warming" value={`${enabled} / ${accounts.length}`} />
          <StatTile label="Warm-up emails (14d)" value={totalSent} />
          <StatTile label="Inbox placement (14d)" value={totalSent ? `${100 - pct(totalSpam, totalSent)}%` : "—"} sub={`${totalSpam} rescued from spam`} />
          <StatTile label="Network size" value={networkSize} sub="active warm-up inboxes" />
        </div>
        <Card>
          <Table>
            <THead>
              <tr><th>Inbox</th><th>Warm-up</th><th>Ramp-up</th><th>Today</th><th>Sent (14d)</th><th>Received</th><th>Replied</th><th>Inbox rate</th><th /></tr>
            </THead>
            <TBody>
              {accounts.map((a) => {
                const sent = S.get(a.id) ?? 0;
                const spam = SP.get(a.id) ?? 0;
                const day = a.warmupStartedAt ? Math.floor((Date.now() - a.warmupStartedAt.getTime()) / 86_400_000) + 1 : 0;
                const rate = sent ? 100 - pct(spam, sent) : null;
                return (
                  <tr key={a.id}>
                    <td><Link href={`/accounts/${a.id}`} className="font-medium text-royal-800 hover:underline">{a.emailAddress}</Link></td>
                    <td>{a.isWarmupEnabled ? <Badge variant="warning">on</Badge> : <Badge variant="muted">off</Badge>}</td>
                    <td className="text-xs text-muted-foreground">{a.isWarmupEnabled ? `day ${day} · target ${dailyWarmupTarget(a)}/day` : "—"}</td>
                    <td className="tabular-nums">{T.get(a.id) ?? 0}</td>
                    <td className="tabular-nums">{sent}</td>
                    <td className="tabular-nums">{R.get(a.id) ?? 0}</td>
                    <td className="tabular-nums">{RP.get(a.id) ?? 0}</td>
                    <td className="tabular-nums">
                      {rate === null ? "—" : <span className={rate >= 90 ? "text-emerald-700" : rate >= 75 ? "text-amber-700" : "text-red-700"}>{rate}%</span>}
                    </td>
                    <td>
                      <form action={toggleWarmup.bind(null, a.id, !a.isWarmupEnabled)}>
                        <Button size="sm" variant="ghost">{a.isWarmupEnabled ? "Disable" : "Enable"}</Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
