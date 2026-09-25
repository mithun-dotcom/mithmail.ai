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
import { addTrackingDomain, deleteTrackingDomain, recheckAllDomains, verifyTrackingDomain } from "./actions";

export default async function DeliverabilityPage() {
  const { workspace } = await requireWorkspace();
  const [health, trackingDomains] = await Promise.all([
    db.domainHealth.findMany({
      where: { emailAccount: { workspaceId: workspace.id } },
      include: { emailAccount: { select: { emailAddress: true } } },
      orderBy: { domain: "asc" },
    }),
    db.trackingDomain.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" } }),
  ]);

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
