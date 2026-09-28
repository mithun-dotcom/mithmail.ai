import { Worker } from "bullmq";
import { db } from "@/lib/db";
import { getQueue, QUEUES, redisConnection, type SalesblinkJob } from "@/server/queue";
import { launchOnSalesblink, pushLeads, pushSenderSettings, removeLeadsFromList, syncSenders, syncWorkspace } from "@/server/salesblink/service";
import { logger } from "./logger";

/** Every workspace running on the SalesBlink engine gets a sync job (de-duplicated per 5-minute slot). */
export async function enqueueSalesblinkSyncs() {
  const workspaces = await db.workspace.findMany({ where: { sendingEngine: "SALESBLINK", salesblinkApiKeyEnc: { not: null } }, select: { id: true } });
  const slot = Math.floor(Date.now() / 300_000);
  await getQueue(QUEUES.salesblink).addBulk(
    workspaces.map((w) => ({ name: "sync", data: { kind: "sync", workspaceId: w.id } satisfies SalesblinkJob, opts: { jobId: `sb-sync-${w.id}-${slot}`, attempts: 1 } })),
  );
  return workspaces.length;
}

export function startSalesblinkWorker() {
  return new Worker<SalesblinkJob>(
    QUEUES.salesblink,
    async (job) => {
      const d = job.data;
      switch (d.kind) {
        case "fanout":
          return { enqueued: await enqueueSalesblinkSyncs() };
        case "sync": {
          const res = await syncWorkspace(d.workspaceId);
          if (Object.values(res).some((n) => n > 0)) logger.info("salesblink sync", { workspace: d.workspaceId, ...res });
          return res;
        }
        case "sync-senders": {
          const res = await syncSenders(d.workspaceId, { healthBudget: 25 });
          logger.info("salesblink senders", { workspace: d.workspaceId, ...res });
          return res;
        }
        case "launch":
          await launchOnSalesblink(d.campaignId);
          logger.info("salesblink launch", { campaign: d.campaignId });
          return { launched: true };
        case "push-leads":
          return { pushed: await pushLeads(d.campaignId) };
        case "push-senders": {
          const accounts = await db.emailAccount.findMany({ where: { workspaceId: d.workspaceId, salesblinkSenderId: { not: null } } });
          for (const a of accounts) await pushSenderSettings(a);
          return { pushed: accounts.length };
        }
        case "remove-leads":
          return { removed: await removeLeadsFromList(d.campaignId, d.emails) };
      }
    },
    // Low concurrency: SalesBlink rate limits are per key (15 writes/min).
    { connection: redisConnection(), concurrency: 2 },
  );
}
