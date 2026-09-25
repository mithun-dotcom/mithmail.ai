import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pct } from "@/lib/utils";

export interface CampaignStats {
  sent: number; // emails
  contacted: number; // unique leads emailed
  opened: number; // unique leads
  clicked: number;
  replied: number;
  bounced: number;
  positive: number; // interested + meeting booked
  openRate: number;
  clickRate: number;
  replyRate: number;
  bounceRate: number;
}

const EMPTY: CampaignStats = { sent: 0, contacted: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, positive: 0, openRate: 0, clickRate: 0, replyRate: 0, bounceRate: 0 };

type Row = { campaignId: string; sent: bigint; contacted: bigint; opened: bigint; clicked: bigint; replied: bigint; bounced: bigint };

export async function campaignStats(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  if (campaignIds.length === 0) return out;
  const rows = await db.$queryRaw<Row[]>`
    SELECT "campaignId",
      count(*) FILTER (WHERE "sentAt" IS NOT NULL)                             AS sent,
      count(DISTINCT "leadId") FILTER (WHERE "sentAt" IS NOT NULL)             AS contacted,
      count(DISTINCT "leadId") FILTER (WHERE "openedAt" IS NOT NULL)           AS opened,
      count(DISTINCT "leadId") FILTER (WHERE "clickedAt" IS NOT NULL)          AS clicked,
      count(DISTINCT "leadId") FILTER (WHERE "repliedAt" IS NOT NULL)          AS replied,
      count(DISTINCT "leadId") FILTER (WHERE "status" = 'BOUNCED')             AS bounced
    FROM "EmailLog"
    WHERE "campaignId" IN (${Prisma.join(campaignIds.map((id) => Prisma.sql`${id}::uuid`))})
    GROUP BY "campaignId"`;
  const positives = await db.thread.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: campaignIds }, summaryStatus: { in: ["INTERESTED", "MEETING_BOOKED"] } },
    _count: true,
  });
  const posMap = new Map(positives.map((p) => [p.campaignId, p._count]));

  for (const id of campaignIds) out.set(id, { ...EMPTY, positive: posMap.get(id) ?? 0 });
  for (const r of rows) {
    const s = {
      sent: Number(r.sent),
      contacted: Number(r.contacted),
      opened: Number(r.opened),
      clicked: Number(r.clicked),
      replied: Number(r.replied),
      bounced: Number(r.bounced),
    };
    out.set(r.campaignId, {
      ...s,
      positive: posMap.get(r.campaignId) ?? 0,
      openRate: pct(s.opened, s.contacted),
      clickRate: pct(s.clicked, s.contacted),
      replyRate: pct(s.replied, s.contacted),
      bounceRate: pct(s.bounced, s.contacted),
    });
  }
  return out;
}

export interface DailyPoint {
  date: string; // yyyy-mm-dd
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
}

/** Day-by-day activity for a workspace (optionally one campaign), zero-filled. */
export async function dailySeries(workspaceId: string, days: number, campaignId?: string): Promise<DailyPoint[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const campaignFilter = campaignId ? Prisma.sql`AND l."campaignId" = ${campaignId}::uuid` : Prisma.empty;

  const q = (col: string) => Prisma.sql`
    SELECT to_char(date_trunc('day', l.${Prisma.raw(`"${col}"`)} AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, count(*)::int AS n
    FROM "EmailLog" l JOIN "Campaign" c ON c.id = l."campaignId"
    WHERE c."workspaceId" = ${workspaceId}::uuid AND l.${Prisma.raw(`"${col}"`)} >= ${since} ${campaignFilter}
    GROUP BY 1`;

  const [sent, opened, clicked, replied, bounced] = await Promise.all(
    ["sentAt", "openedAt", "clickedAt", "repliedAt", "bouncedAt"].map((c) => db.$queryRaw<{ d: string; n: number }[]>(q(c))),
  );
  const series = new Map<string, DailyPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.set(key, { date: key, sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 });
  }
  const apply = (rows: { d: string; n: number }[], k: keyof Omit<DailyPoint, "date">) => {
    for (const r of rows) {
      const p = series.get(r.d);
      if (p) p[k] = Number(r.n);
    }
  };
  apply(sent, "sent");
  apply(opened, "opened");
  apply(clicked, "clicked");
  apply(replied, "replied");
  apply(bounced, "bounced");
  return [...series.values()];
}
