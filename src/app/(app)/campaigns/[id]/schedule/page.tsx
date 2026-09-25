import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { ScheduleForm } from "./schedule-form";

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();
  const c = await db.campaign.findFirstOrThrow({ where: { id, workspaceId: workspace.id }, include: { schedule: true } });
  return (
    <ScheduleForm
      campaignId={id}
      initial={{
        timezone: c.scheduleTimezone,
        daysOfWeek: c.schedule?.daysOfWeek ?? [1, 2, 3, 4, 5],
        startTime: c.schedule?.startTime ?? "09:00",
        endTime: c.schedule?.endTime ?? "17:00",
      }}
    />
  );
}
