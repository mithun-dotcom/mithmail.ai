import type { ThreadSummaryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { htmlToText } from "@/lib/template";
import { apiHandler } from "@/server/api-auth";

const LABELS = ["INTERESTED", "MEETING_BOOKED", "NOT_INTERESTED", "OUT_OF_OFFICE", "WRONG_PERSON", "UNSUBSCRIBE_REQUEST", "NEUTRAL"];

export const GET = apiHandler(async (req, ws) => {
  const label = new URL(req.url).searchParams.get("label")?.toUpperCase();
  const threads = await db.thread.findMany({
    where: { workspaceId: ws.id, ...(label && LABELS.includes(label) ? { summaryStatus: label as ThreadSummaryStatus } : {}) },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: { messages: { orderBy: { receivedAt: "asc" }, select: { direction: true, fromEmail: true, subject: true, body: true, receivedAt: true } } },
  });
  return threads.map((t) => ({ ...t, messages: t.messages.map((m) => ({ ...m, body: htmlToText(m.body) })) }));
});
