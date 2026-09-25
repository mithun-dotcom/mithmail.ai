import type { EmailEventType } from "@prisma/client";
import { db } from "@/lib/db";
import { emitEvent } from "./webhooks";

const UUID = /^[0-9a-f-]{36}$/i;

// Link scanners and image proxies often fetch within seconds of delivery.
const BOT_UA = /(bot|crawler|spider|preview|scanner|barracuda|mimecast|proofpoint|safelinks|urldefense)/i;

export async function recordEvent(logId: string, type: EmailEventType, meta: { ip?: string | null; ua?: string | null; url?: string }) {
  if (!UUID.test(logId)) return null;
  const log = await db.emailLog.findUnique({ where: { id: logId }, include: { campaign: { select: { workspaceId: true } }, lead: { select: { email: true } } } });
  if (!log || !log.sentAt) return null;

  const suspicious = (meta.ua && BOT_UA.test(meta.ua)) || Date.now() - log.sentAt.getTime() < 5_000;
  await db.emailEvent.create({ data: { emailLogId: logId, type, url: meta.url, ip: meta.ip ?? null, userAgent: meta.ua ?? null } });
  if (suspicious && type !== "UNSUBSCRIBE") return log;

  const now = new Date();
  if (type === "OPEN") {
    await db.emailLog.update({
      where: { id: logId },
      data: {
        openCount: { increment: 1 },
        openedAt: log.openedAt ?? now,
        ...(log.status === "SENT" || log.status === "DELIVERED" ? { status: "OPENED" } : {}),
      },
    });
    if (!log.openedAt) await emitEvent(log.campaign.workspaceId, "email.opened", { leadEmail: log.lead.email, campaignId: log.campaignId });
  } else if (type === "CLICK") {
    await db.emailLog.update({
      where: { id: logId },
      data: {
        clickCount: { increment: 1 },
        clickedAt: log.clickedAt ?? now,
        openedAt: log.openedAt ?? now, // a click implies an open
        ...(["SENT", "DELIVERED", "OPENED"].includes(log.status) ? { status: "CLICKED" } : {}),
      },
    });
    if (!log.clickedAt) await emitEvent(log.campaign.workspaceId, "email.clicked", { leadEmail: log.lead.email, campaignId: log.campaignId, url: meta.url });
  } else if (type === "UNSUBSCRIBE") {
    await db.$transaction([
      db.lead.update({ where: { id: log.leadId }, data: { status: "UNSUBSCRIBED", unsubscribedAt: now } }),
      db.campaignLead.updateMany({ where: { leadId: log.leadId, status: "ACTIVE" }, data: { status: "FINISHED", nextSendAt: null } }),
      db.globalBlocklist.upsert({
        where: { workspaceId_emailOrDomain: { workspaceId: log.campaign.workspaceId, emailOrDomain: log.lead.email } },
        create: { workspaceId: log.campaign.workspaceId, emailOrDomain: log.lead.email },
        update: {},
      }),
    ]);
    await emitEvent(log.campaign.workspaceId, "lead.unsubscribed", { leadEmail: log.lead.email, campaignId: log.campaignId });
  }
  return log;
}

export function clientMeta(req: Request) {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip"),
    ua: req.headers.get("user-agent"),
  };
}
