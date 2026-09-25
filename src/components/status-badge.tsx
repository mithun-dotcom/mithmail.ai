import { Badge } from "@/components/ui/badge";

type V = "success" | "danger" | "warning" | "muted" | "default";
const MAP: Record<string, V> = {
  ACTIVE: "success",
  PAUSED: "warning",
  ERROR: "danger",
  DISCONNECTED: "danger",
  DRAFT: "muted",
  COMPLETED: "default",
  FINISHED: "default",
  UNCONTACTED: "muted",
  CONTACTED: "default",
  REPLIED: "success",
  BOUNCED: "danger",
  UNSUBSCRIBED: "warning",
  INTERESTED: "success",
  MEETING_BOOKED: "success",
  NOT_INTERESTED: "danger",
  OUT_OF_OFFICE: "warning",
  WRONG_PERSON: "muted",
  UNSUBSCRIBE_REQUEST: "warning",
  NEUTRAL: "muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={MAP[status] ?? "default"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}
