/**
 * End-to-end pipeline tests against real PostgreSQL + Redis and in-process SMTP/IMAP.
 *   npm run test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { runSchedulerTick } from "@/server/sending/scheduler";
import { processSendJob } from "@/server/sending/sender";
import { syncInbox } from "@/server/inbox/imap-sync";
import { sendWarmupEmail, sendWarmupReply } from "@/server/warmup/engine";
import { getQueue, QUEUES, redis } from "@/server/queue";
import { header, startHarness, type Harness } from "./mail-harness";

const run = randomUUID().slice(0, 6);
const SENDER_A = `alex-${run}@send-a.test`;
const SENDER_B = `blair-${run}@send-b.test`;
const LEAD_1 = `lead1-${run}@prospect.test`;
const LEAD_2 = `lead2-${run}@prospect.test`;
const LEAD_BOUNCE = `bounce-${run}@prospect.test`;

let h: Harness;
let workspaceId: string;
let campaignId: string;

async function queuedLogIds() {
  return (await db.emailLog.findMany({ where: { campaignId, status: "QUEUED" }, select: { id: true } })).map((l) => l.id);
}

async function tickAndSend(): Promise<string[]> {
  // Clear per-inbox pacing so each tick can use every inbox.
  const r = await redis();
  const accounts = await db.emailAccount.findMany({ where: { workspaceId }, select: { id: true } });
  if (accounts.length) await r.del(...accounts.map((a) => `mm:pace:${a.id}`));
  await runSchedulerTick();
  const ids = await queuedLogIds();
  const results: string[] = [];
  for (const id of ids) results.push(await processSendJob(id, true));
  return results;
}

beforeAll(async () => {
  h = await startHarness({ mailboxes: [SENDER_A, SENDER_B], spamFor: [SENDER_B], basePort: 21000 + Math.floor(Math.random() * 2000) });
  const ws = await db.workspace.create({ data: { name: `it-${run}`, slug: `it-${run}`, monthlyEmailQuota: 1000 } });
  workspaceId = ws.id;
  const mkAccount = (email: string) =>
    db.emailAccount.create({
      data: {
        workspaceId,
        emailAddress: email,
        provider: "SMTP",
        smtpHost: "localhost",
        smtpPort: h.smtpPort,
        smtpUser: email,
        smtpPassEnc: encrypt("p"),
        imapHost: "localhost",
        imapPort: h.imapPort(email),
        imapUser: email,
        imapPassEnc: encrypt("p"),
        minDelaySeconds: 0,
        maxDelaySeconds: 0,
      },
    });
  const [a, b] = [await mkAccount(SENDER_A), await mkAccount(SENDER_B)];
  const leads = await Promise.all(
    [LEAD_1, LEAD_2, LEAD_BOUNCE].map((email, i) => db.lead.create({ data: { workspaceId, email, firstName: `Lead${i + 1}`, companyName: "Prospect Co", esp: "OTHER" } })),
  );
  const c = await db.campaign.create({
    data: {
      workspaceId,
      name: "Integration",
      status: "ACTIVE",
      scheduleTimezone: "UTC",
      trackOpens: true,
      schedule: { create: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" } },
      steps: {
        create: [
          { stepNumber: 1, waitDays: 0, subject: "Hello {{first_name}}", bodySpintax: "{Hi|Hey} {{first_name}}, quick question about {{company_name}}." },
          { stepNumber: 2, waitDays: 0, subject: "", bodySpintax: "Following up, {{first_name}}." },
          { stepNumber: 3, waitDays: 5, subject: "", bodySpintax: "Last note, {{first_name}}." },
        ],
      },
      emailAccounts: { create: [{ emailAccountId: a.id }, { emailAccountId: b.id }] },
      campaignLeads: { create: leads.map((l) => ({ leadId: l.id, nextSendAt: new Date(Date.now() - 1000) })) },
    },
  });
  campaignId = c.id;
});

afterAll(async () => {
  // Only remove this run's jobs — a dev worker may share the Redis instance.
  const q = getQueue(QUEUES.sendEmail);
  for (const l of await db.emailLog.findMany({ where: { campaignId }, select: { id: true } })) await q.remove(l.id).catch(() => undefined);
  await db.warmupLog.deleteMany({ where: { sender: { workspaceId } } });
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  await db.workspace.deleteMany({ where: { slug: `it-${run}-peer` } });
  await h.close();
  (await redis()).disconnect();
  await db.$disconnect();
});

describe("campaign pipeline", () => {
  it("rotates across the inbox pool, prioritises follow-ups, threads them, and classifies a hard bounce", async () => {
    const first = await tickAndSend();
    expect(first).toEqual(["sent", "sent"]); // two inboxes → one send each per tick

    // Follow-ups (step 2, waitDays 0) take priority over the not-yet-contacted third lead.
    const second = await tickAndSend();
    expect(second).toEqual(["sent", "sent"]);
    const third = await tickAndSend();
    expect(third).toEqual(["bounced"]);
    expect(await tickAndSend()).toEqual([]); // step 3 is 5 days away

    const toLead1 = h.outside.filter((m) => m.to === LEAD_1);
    expect(toLead1).toHaveLength(2);
    const [m1, m2] = toLead1;
    expect(header(m1.raw, "Subject")).toBe("Hello Lead1");
    expect(header(m2.raw, "Subject")).toBe("Re: Hello Lead1");
    expect(header(m2.raw, "In-Reply-To")).toBe(header(m1.raw, "Message-ID"));
    expect(header(m2.raw, "From")).toBe(header(m1.raw, "From")); // sticky sender
    expect(header(m1.raw, "From")).not.toBe(header(h.outside.find((m) => m.to === LEAD_2)!.raw, "From")); // rotation

    expect((await db.lead.findFirstOrThrow({ where: { workspaceId, email: LEAD_BOUNCE } })).status).toBe("BOUNCED");
    expect(await db.campaignLead.count({ where: { campaignId, status: "FINISHED" } })).toBe(1);
    expect(await db.campaignLead.count({ where: { campaignId, status: "ACTIVE", currentStepNumber: 2 } })).toBe(2);
  });

  it("detects a reply over IMAP, labels it and stops the sequence", async () => {
    const log = await db.emailLog.findFirstOrThrow({
      where: { campaignId, lead: { email: LEAD_2 }, campaignStep: { stepNumber: 1 } },
      include: { emailAccount: true },
    });
    const replyRaw = [
      `From: Lead Two <${LEAD_2}>`,
      `To: ${log.emailAccount.emailAddress}`,
      `Subject: Re: ${log.subject}`,
      `Message-ID: <reply-${run}@prospect.test>`,
      `In-Reply-To: ${log.messageId}`,
      `References: ${log.messageId}`,
      `Date: ${new Date().toUTCString()}`,
      "",
      "Sounds good, tell me more please.",
    ].join("\r\n");
    h.deliver(log.emailAccount.emailAddress, replyRaw);

    const res = await syncInbox(log.emailAccount);
    expect(res.replies).toBe(1);
    const thread = await db.thread.findFirstOrThrow({ where: { workspaceId, leadEmail: LEAD_2 }, include: { messages: true } });
    expect(thread.summaryStatus).toBe("INTERESTED");
    expect(thread.messages.some((m) => m.direction === "INBOUND")).toBe(true);
    expect(thread.messages.some((m) => m.direction === "OUTBOUND")).toBe(true);
    const cl = await db.campaignLead.findFirstOrThrow({ where: { campaignId, lead: { email: LEAD_2 } } });
    expect(cl.status).toBe("PAUSED"); // stop-on-reply
    // The other lead keeps going.
    expect((await db.campaignLead.findFirstOrThrow({ where: { campaignId, lead: { email: LEAD_1 } } })).status).toBe("ACTIVE");
    expect((await db.lead.findFirstOrThrow({ where: { workspaceId, email: LEAD_2 } })).status).toBe("REPLIED");

    // Re-syncing is idempotent.
    expect((await syncInbox(await db.emailAccount.findUniqueOrThrow({ where: { id: log.emailAccountId } }))).replies).toBe(0);
  });
});

describe("warm-up network", () => {
  it("rescues from spam, flags important, replies, and never touches the Unibox", async () => {
    // Warm-up peers must be in different workspaces; move B into its own workspace for this test.
    const peer = await db.workspace.create({ data: { name: "peer", slug: `it-${run}-peer` } });
    const a = await db.emailAccount.update({ where: { workspaceId_emailAddress: { workspaceId, emailAddress: SENDER_A } }, data: { isWarmupEnabled: true, warmupStartedAt: new Date() } });
    const b = await db.emailAccount.update({
      where: { workspaceId_emailAddress: { workspaceId, emailAddress: SENDER_B } },
      data: { workspaceId: peer.id, isWarmupEnabled: true, warmupStartedAt: new Date(), warmupReplyRate: 100 },
    });

    expect(await sendWarmupEmail(a.id, b.id)).toBe("sent");
    expect(h.mailbox(SENDER_B, "Junk")).toHaveLength(1); // landed in spam

    const bSync = await syncInbox(await db.emailAccount.findUniqueOrThrow({ where: { id: b.id } }));
    expect(bSync.rescued).toBe(1);
    expect(h.mailbox(SENDER_B, "Junk")).toHaveLength(0);
    const rescued = h.mailbox(SENDER_B).find((m) => /x-mithmill-warmup/i.test(m.raw))!;
    expect(rescued.flags).toEqual(expect.arrayContaining(["\\Seen", "\\Flagged"]));

    const log = await db.warmupLog.findFirstOrThrow({ where: { senderAccountId: a.id } });
    expect(log.landedInSpam).toBe(true);
    expect(log.status).toBe("RESCUED_FROM_SPAM");
    expect(log.replyScheduledAt).not.toBeNull();

    expect(await sendWarmupReply(b.id, log.id)).toBe("replied");
    const aSync = await syncInbox(await db.emailAccount.findUniqueOrThrow({ where: { id: a.id } }));
    expect(aSync.warmups).toBe(1);
    expect(aSync.replies).toBe(0);
    expect((await db.warmupLog.findUniqueOrThrow({ where: { id: log.id } })).status).toBe("REPLIED");
    expect(await db.thread.count({ where: { leadEmail: { in: [SENDER_A, SENDER_B] } } })).toBe(0);

    await getQueue(QUEUES.warmup).remove(`reply-${log.id}`).catch(() => undefined);
  });
});
