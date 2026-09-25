import { formatDistanceToNow } from "date-fns";
import { RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DnsBadge } from "@/components/dns-badge";
import { Select } from "@/components/ui/select";
import { placementSeeds, type PlacementResult } from "@/server/deliverability/placement";
import { addTrackingDomain, deleteTrackingDomain, recheckAllDomains, runPlacementTest, verifyTrackingDomain } from "./actions";

export default async function DeliverabilityPage() {
  const { workspace } = await requireWorkspace();
  const [health, trackingDomains, accounts, tests] = await Promise.all([
    db.domainHealth.findMany({
      where: { emailAccount: { workspaceId: workspace.id } },
      include: { emailAccount: { select: { emailAddress: true } } },
      orderBy: { domain: "asc" },
    }),
    db.trackingDomain.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }),
    db.emailAccount.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE" }, select: { id: true, emailAddress: true }, orderBy: { emailAddress: "asc" } }),
    db.placementTest.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const accountNames = new Map(accounts.map((a) => [a.id, a.emailAddress]));
  const seedCount = placementSeeds().length;

  const domains = new Map<string, { h: (typeof health)[number]; inboxes: number }>();
  for (const h of health) {
    const cur = domains.get(h.domain);
    domains.set(h.domain, { h: cur?.h ?? h, inboxes: (cur?.inboxes ?? 0) + 1 });
  }
  const failing = [...domains.values()].filter(({ h }) => [h.spfStatus, h.dkimStatus, h.dmarcStatus].some((s) => s === "MISSING" || s === "INVALID")).length;
  const cnameTarget = process.env.TRACKING_CNAME_TARGET ?? "track.mithmill.app";

  return (
    <>
      <PageHeader
        title="Deliverability"
        description={`${domains.size} sending domains · ${failing} need attention · checked automatically every day`}
        actions={
          <form action={recheckAllDomains}>
            <Button variant="outline"><RefreshCw /> Re-check all</Button>
          </form>
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Domain authentication</CardTitle>
            <CardDescription>SPF, DKIM and DMARC must all pass before a domain sends cold email.</CardDescription>
          </CardHeader>
          <Table>
            <THead>
              <tr><th>Domain</th><th>Inboxes</th><th>Records</th><th>Last check</th></tr>
            </THead>
            <TBody>
              {[...domains.entries()].map(([domain, { h, inboxes }]) => (
                <tr key={domain}>
                  <td className="font-medium">{domain}</td>
                  <td>{inboxes}</td>
                  <td className="space-x-1">
                    <DnsBadge label="SPF" status={h.spfStatus} />
                    <DnsBadge label="DKIM" status={h.dkimStatus} />
                    <DnsBadge label="DMARC" status={h.dmarcStatus} />
                    <DnsBadge label="MX" status={h.mxStatus} />
                  </td>
                  <td className="text-muted-foreground">{h.lastCheckedAt ? `${formatDistanceToNow(h.lastCheckedAt)} ago` : "—"}</td>
                </tr>
              ))}
              {domains.size === 0 && (
                <tr><td colSpan={4} className="text-center text-muted-foreground">Connect an inbox to see its domain health.</td></tr>
              )}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inbox placement tests</CardTitle>
            <CardDescription>
              Sends a test email to {seedCount || "no"} seed inboxes across providers and reports whether it landed in the inbox or spam.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {seedCount ? (
              <form action={runPlacementTest} className="flex max-w-lg gap-2">
                <Select name="emailAccountId" required>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.emailAddress}</option>
                  ))}
                </Select>
                <Button type="submit" disabled={!accounts.length}>Run test</Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Configure seed inboxes with the PLACEMENT_SEEDS environment variable to enable placement tests.</p>
            )}
            {tests.map((t) => {
              const results = (t.results as PlacementResult[] | null) ?? [];
              return (
                <div key={t.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{accountNames.get(t.emailAccountId) ?? "removed inbox"}</span>
                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(t.createdAt)} ago</span>
                    {t.status === "COMPLETED" ? (
                      <Badge variant={(t.inboxRate ?? 0) >= 80 ? "success" : (t.inboxRate ?? 0) >= 50 ? "warning" : "danger"}>{t.inboxRate}% inbox</Badge>
                    ) : (
                      <Badge variant="muted">{t.status.toLowerCase()}…</Badge>
                    )}
                  </div>
                  {results.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {results.map((r) => (
                        <Badge key={r.seed} variant={r.folder === "INBOX" ? "success" : r.folder === "SPAM" ? "danger" : "muted"}>
                          {r.provider}: {r.folder.toLowerCase()}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom tracking domains</CardTitle>
            <CardDescription>
              Open and click tracking on a shared domain hurts deliverability. Create a CNAME from a subdomain you own to{" "}
              <code className="rounded bg-muted px-1">{cnameTarget}</code>, then verify it here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form action={addTrackingDomain} className="flex max-w-md gap-2">
              <Input name="domainName" placeholder="track.yourdomain.com" required />
              <Button type="submit">Add</Button>
            </form>
            <div className="grid gap-2">
              {trackingDomains.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border px-4 py-2">
                  <span className="flex-1 font-medium">{d.domainName}</span>
                  {d.cnameVerified ? <Badge variant="success">verified</Badge> : <Badge variant="warning">CNAME not found</Badge>}
                  <form action={verifyTrackingDomain.bind(null, d.id)}><Button size="sm" variant="outline">Verify</Button></form>
                  <form action={deleteTrackingDomain.bind(null, d.id)}><Button size="sm" variant="ghost">Delete</Button></form>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
