import type { DnsRecordStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<DnsRecordStatus, "success" | "danger" | "warning" | "muted"> = {
  VALID: "success",
  INVALID: "danger",
  MISSING: "danger",
  PENDING: "muted",
};

export function DnsBadge({ label, status }: { label: string; status?: DnsRecordStatus | null }) {
  const s = status ?? "PENDING";
  return (
    <Badge variant={VARIANT[s]} title={`${label}: ${s.toLowerCase()}`}>
      {label}
      {s === "VALID" ? " ✓" : s === "PENDING" ? " …" : " ✕"}
    </Badge>
  );
}
