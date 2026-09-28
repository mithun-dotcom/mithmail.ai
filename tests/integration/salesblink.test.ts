/**
 * SalesBlink engine end-to-end against an in-process mock of the SalesBlink API
 * (response shapes from docs/salesblink-openapi.json) + real Postgres/Redis.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { redis } from "@/server/queue";
import { runSchedulerTick } from "@/server/sending/scheduler";
import { clientFor, launchOnSalesblink, SB_THREAD_PREFIX, syncSenders, syncWorkspace } from "@/server/salesblink/service";
import { startSalesblinkMock } from "./salesblink-mock";

const KEY = `sb_test_${randomUUID()}`;
const run = randomUUID().slice(0, 6);
let mock: Awaited<ReturnType<typeof startSalesblinkMock>>;
let workspaceId: string;
let campaignId: string;

beforeAll(async () => {
  mock = await startSalesblinkMock(KEY);
  process.env.SALESBLINK_API_URL = mock.url;
  const ws = await db.workspace.create({
    data: { name: `sb-${run}`, slug: `sb-${run}`, sendingEngine: "SALESBLINK", salesblinkApiKeyEnc: encrypt(KEY) },
  });
  workspaceId = ws.id;
});

afterAll(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  await mock.close();
  (await redis()).disconnect();
  await db.$disconnect();
});

describe("SalesBlink engine", () => {
  it("imports SalesBlink senders as inboxes with health", async () => {
    const r = await syncSenders(workspaceId);
    expect(r.senders).toBe(2);
    const accounts = await db.emailAccount.findMany({ where: { workspaceId }, orderBy: { emailAddress: "asc" } });
    expect(accounts.map((a) => [a.emailAddress, a.salesblinkSenderId, a.healthScore, a.status])).toEqual([
      ["alex@getsend.io", "snd_smtp", 71, "ACTIVE"],
      ["sam@trysend.io", "snd_google", 92, "ACTIVE"],
    ]);
    expect(accounts.every((a) => !a.smtpPassEnc && !a.imapPassEnc)).toBe(true);
    // Re-sync is idempotent.
    await syncSenders(workspaceId);
    expect(await db.emailAccount.count({ where: { workspaceId } })).toBe(2);
    // Every call carried the raw key in the Authorization header.
    expect(mock.calls.every((c) => c.auth === KEY)).toBe(true);
  });

  it("launches a campaign: list, personalised contacts, templates and sequence", async () => {
    const accounts = await db.emailAccount.findMany({ where: { workspaceId } });
    const leads = await Promise.all(
      ["ana@acme.test", "bo@globex.test"].map((email, i) => db.lead.create({ data: { workspaceId, email, firstName: i === 0 ? "Ana" : null, companyName: i === 0 ? "Acme" : "Globex" } })),
    );
    const c = await db.campaign.create({
      data: {
        workspaceId,
        name: "SB launch",
        engine: "SALESBLINK",
        scheduleTimezone: "Asia/Kolkata",
        stopOnReply: true,
        schedule: { create: { daysOfWeek: [1, 2, 3, 4, 5], startTime: "10:00", endTime: "18:00" } },
        steps: {
          create: [
            { stepNumber: 1, waitDays: 0, subject: "{Quick q|Idea} for {{company_name}}", bodySpintax: "{Hi|Hey} {{first_name|there}},\n\nWorth a chat?" },
            { stepNumber: 2, waitDays: 3, subject: "", bodySpintax: "Bumping this." },
          ],
        },
        emailAccounts: { create: accounts.map((a) => ({ emailAccountId: a.id })) },
        campaignLeads: { create: leads.map((l) => ({ leadId: l.id })) },
      },
    });
    campaignId = c.id;

    await launchOnSalesblink(c.id);

    const saved = await db.campaign.findUniqueOrThrow({ where: { id: c.id }, include: { steps: { orderBy: { stepNumber: "asc" } } } });
    expect(saved).toMatchObject({ status: "ACTIVE", sbLaunchState: "LAUNCHED" });
    expect(saved.sbListId).toBeTruthy();
    expect(saved.sbSequenceId).toBeTruthy();

    // Contacts carry fully rendered, per-lead emails.
    const list = mock.state.lists.get(saved.sbListId!)!;
    expect(list.contacts).toHaveLength(2);
    const bo = list.contacts.find((x) => x.email === "bo@globex.test")!;
    expect(bo.mm_subject_1).toMatch(/^(Quick q|Idea) for Globex$/);
    expect(bo.mm_body_1).toMatch(/^<p>(Hi|Hey) there,<\/p><p>Worth a chat\?<\/p>$/);
    expect(bo.mm_subject_2).toBe(`Re: ${bo.mm_subject_1}`);

    // Templates just reference those fields.
    const tpl1 = mock.state.templates.get(saved.steps[0].sbTemplateId!)!;
    expect(tpl1).toMatchObject({ subject_line: "{{mm_subject_1}}", content: "{{mm_body_1}}" });

    // Sequence: email, delay 3, email; all senders; schedule and options mapped.
    const seq = mock.state.sequences.get(saved.sbSequenceId!)!;
    expect(seq.steps).toEqual([
      { type: "email", template_id: saved.steps[0].sbTemplateId },
      { type: "delay", days: 3 },
      { type: "email", template_id: saved.steps[1].sbTemplateId },
    ]);
    expect(String(seq.senders).split(",").sort()).toEqual(["snd_google", "snd_smtp"]);
    expect(seq).toMatchObject({ lists: [saved.sbListId], timezone: "Asia/Kolkata", paused: false, stopWhenReplyRecieved: true, matchProvider: true });
    expect((seq.emailSendingHours as { name: string; enabled: boolean }[]).filter((d) => d.enabled).map((d) => d.name)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);

    // Relaunch is idempotent: no duplicate list/templates/sequence.
    const before = mock.calls.filter((x) => x.method === "POST").length;
    await launchOnSalesblink(c.id);
    const posts = mock.calls.slice().filter((x) => x.method === "POST").slice(before);
    expect(posts.map((p) => p.path)).toEqual([`/sequences/${saved.sbSequenceId}/status`]);
  });

  it("never lets the built-in scheduler send a SalesBlink campaign", async () => {
    await db.campaignLead.updateMany({ where: { campaignId }, data: { nextSendAt: new Date(0) } });
    await runSchedulerTick();
    expect(await db.emailLog.count({ where: { campaignId, status: "QUEUED" } })).toBe(0);
  });

  it("syncs sent/open activity and inbox replies into MithMill", async () => {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const now = Date.now();
    mock.state.activity.sent.push(
      { id: "ev1", time: now - 60_000, email: "ana@acme.test", sequence: c.sbSequenceId!, message: "Sent from sam@trysend.io" },
      { id: "ev2", time: now - 50_000, email: "bo@globex.test", sequence: c.sbSequenceId! },
    );
    mock.state.activity.opens.push({ id: "op1", time: now - 30_000, email: "ana@acme.test", sequence: c.sbSequenceId! });
    mock.state.inbox.push({
      id: "task_1",
      messageId: "sbmsg_1",
      email: "ana@acme.test",
      data: { email: { subject: "Re: Idea for Acme", body: "<p>Sounds good, tell me more!</p>" } },
      scheduled_time: now - 10_000,
      unread: true,
      sender: "snd_google",
    });

    const res = await syncWorkspace(workspaceId);
    expect(res).toMatchObject({ sent: 2, opens: 1, inbox: 1 });

    const logs = await db.emailLog.findMany({ where: { campaignId }, include: { lead: true, emailAccount: true }, orderBy: { sentAt: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ status: "OPENED", externalId: "sb:sent:ev1" });
    expect(logs[0].emailAccount.emailAddress).toBe("sam@trysend.io"); // sender found in the event message
    expect(logs[0].openedAt).not.toBeNull();

    const thread = await db.thread.findFirstOrThrow({ where: { workspaceId, leadEmail: "ana@acme.test" }, include: { messages: true } });
    expect(thread.summaryStatus).toBe("INTERESTED");
    expect(thread.messages[0].inReplyTo).toBe(`${SB_THREAD_PREFIX}sbmsg_1`);
    expect((await db.lead.findFirstOrThrow({ where: { workspaceId, email: "ana@acme.test" } })).status).toBe("REPLIED");

    // Second sync with nothing new is a no-op (cursors + de-duplication).
    const again = await syncWorkspace(workspaceId);
    expect(again).toMatchObject({ sent: 0, opens: 0, inbox: 0 });
    expect(await db.emailLog.count({ where: { campaignId } })).toBe(2);
  });

  it("marks bounces from SalesBlink sequence lead status", async () => {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    mock.state.sequenceLeads.set(c.sbSequenceId!, [{ lead_id: "l2", email: "bo@globex.test", status: "bounced" }]);
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await db.workspace.update({ where: { id: workspaceId }, data: { salesblinkSyncState: { ...(ws.salesblinkSyncState as object), sendersAt: 0 } } });
    const res = await syncWorkspace(workspaceId);
    expect(res.statusChanges).toBe(1);
    expect((await db.lead.findFirstOrThrow({ where: { workspaceId, email: "bo@globex.test" } })).status).toBe("BOUNCED");
  });

  it("replies and pause go through SalesBlink", async () => {
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await clientFor(ws).reply("sbmsg_1", "<p>Thursday works</p>");
    expect(mock.state.replies).toEqual([{ messageId: "sbmsg_1", content: "<p>Thursday works</p>" }]);
    const { setSalesblinkCampaignStatus } = await import("@/server/salesblink/service");
    await setSalesblinkCampaignStatus(campaignId, "PAUSED");
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(mock.state.sequences.get(c.sbSequenceId!)!.status).toBe("PAUSED");
  });
});

describe("SalesBlink sender paging", () => {
  it("pages past 100 senders, copes with an ignored skip, and finds a sender by email", async () => {
    const saved = [...mock.state.senders];
    try {
      for (let i = 0; i < 148; i++) mock.state.senders.push({ id: `snd_bulk_${i}`, email: `bulk${i}@paging.io`, from_name: "Bulk" });
      mock.state.senders.push({ id: "snd_late", email: "late@montage.io", from_name: "Late" });
      const client = new (await import("@/server/salesblink/client")).SalesBlinkClient(KEY);

      const all = await client.listSenders();
      expect(all).toHaveLength(151);
      expect(all.some((s) => s.id === "snd_late")).toBe(true);

      mock.state.pageParamOnly = true;
      const viaPage = await client.listSenders();
      expect(viaPage).toHaveLength(151);
      mock.state.pageParamOnly = false;

      expect((await client.findSenderByEmail("LATE@montage.io"))?.id).toBe("snd_late");
      expect(await client.findSenderByEmail("nobody@montage.io")).toBeNull();
    } finally {
      mock.state.senders = saved;
      mock.state.pageParamOnly = false;
    }
  });
});
