import type { DomainHealth } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DnsBadge } from "@/components/dns-badge";

const FIX: Record<string, string> = {
  spf: 'Add a TXT record on the root domain, e.g. "v=spf1 include:_spf.google.com ~all" (use your provider\'s include).',
  dkim: "Enable DKIM signing in your email provider's admin console and publish the TXT key it gives you.",
  dmarc: 'Add a TXT record at _dmarc with "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com".',
  mx: "Publish MX records so replies and bounces can be received.",
};

export function DnsHealthCard({ health }: { health: DomainHealth | null }) {
  const rows = [
    { key: "spf", label: "SPF", status: health?.spfStatus, record: health?.spfRecord },
    { key: "dkim", label: "DKIM", status: health?.dkimStatus, record: health?.dkimSelector ? `selector: ${health.dkimSelector}` : null },
    { key: "dmarc", label: "DMARC", status: health?.dmarcStatus, record: health?.dmarcRecord },
    { key: "mx", label: "MX", status: health?.mxStatus, record: null },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Domain health {health && <span className="font-normal text-muted-foreground">· {health.domain}</span>}</CardTitle>
        <CardDescription>
          {health?.lastCheckedAt ? `Checked ${formatDistanceToNow(health.lastCheckedAt)} ago` : "Not checked yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {rows.map((r) => (
          <div key={r.key} className="grid min-w-0 gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <DnsBadge label={r.label} status={r.status} />
              {r.record && <code className="min-w-0 truncate text-xs text-muted-foreground">{r.record}</code>}
            </div>
            {r.status && r.status !== "VALID" && r.status !== "PENDING" && <p className="text-xs text-red-700">{FIX[r.key]}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
