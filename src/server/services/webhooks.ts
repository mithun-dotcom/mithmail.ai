import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getQueue, QUEUES, type WebhookJob } from "@/server/queue";

export const WEBHOOK_EVENTS = [
  "email.sent",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "lead.replied",
  "lead.interested",
  "lead.meeting_booked",
  "lead.not_interested",
  "lead.unsubscribed",
  "campaign.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Fans an event out to every active webhook in the workspace subscribed to it. Never throws. */
export async function emitEvent(workspaceId: string, event: WebhookEvent, payload: Record<string, unknown>) {
  try {
    const hooks = await db.webhook.findMany({ where: { workspaceId, isActive: true, events: { has: event } }, select: { id: true } });
    if (!hooks.length) return;
    const q = getQueue(QUEUES.webhooks);
    await q.addBulk(
      hooks.map((h) => ({
        name: event,
        data: { webhookId: h.id, event, payload: { ...payload, event, workspaceId, timestamp: new Date().toISOString() } } satisfies WebhookJob,
        opts: { attempts: 5, backoff: { type: "exponential", delay: 30_000 } },
      })),
    );
  } catch (e) {
    console.error("emitEvent failed", event, (e as Error).message);
  }
}

export function signPayload(secret: string, body: string, timestamp: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function deliverWebhook(job: WebhookJob) {
  const hook = await db.webhook.findUnique({ where: { id: job.webhookId } });
  if (!hook || !hook.isActive) return { skipped: true };
  const body = JSON.stringify(job.payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(hook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "MithMill-Webhooks/1.0",
      "x-mithmill-event": job.event,
      "x-mithmill-timestamp": ts,
      "x-mithmill-signature": `sha256=${signPayload(decrypt(hook.secretEnc), body, ts)}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
  await db.webhook.update({ where: { id: hook.id }, data: { lastStatus: res.status, lastFiredAt: new Date() } });
  if (!res.ok) throw new Error(`Webhook ${hook.url} responded ${res.status} ${res.statusText}`);
  return { status: res.status };
}
