"use client";

import { useEffect, useTransition } from "react";
import type { ThreadSummaryStatus } from "@prisma/client";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { markRead, setLabel } from "./actions";

const LABELS: ThreadSummaryStatus[] = ["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "UNSUBSCRIBE_REQUEST", "NEUTRAL"];

export function ThreadActions({ id, label, isRead }: { id: string; label: ThreadSummaryStatus | null; isRead: boolean }) {
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!isRead) start(() => markRead(id, true));
  }, [id, isRead]);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={label ?? ""}
        disabled={pending}
        onChange={(e) => start(() => setLabel(id, (e.target.value || null) as ThreadSummaryStatus | null))}
        className="w-48"
      >
        <option value="">No label</option>
        {LABELS.map((l) => (
          <option key={l} value={l}>{l.toLowerCase().replace(/_/g, " ")}</option>
        ))}
      </Select>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => start(() => markRead(id, false))}>
        Mark unread
      </Button>
    </div>
  );
}
