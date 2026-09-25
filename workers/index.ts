import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import type { Worker } from "bullmq";
import { getQueue, QUEUES } from "@/server/queue";
import { startDnsCheckWorker } from "./dns-check";
import { startSchedulerWorker, startSendWorker, startWebhookWorker } from "./send-email";
import { startAiWorker, startFetchRepliesWorker, startPlacementWorker, startWarmupWorker } from "./inbox";
import { logger } from "./logger";

async function scheduleRepeatables() {
  // Daily DNS audit at 03:00 UTC.
  await getQueue(QUEUES.dnsCheck).upsertJobScheduler("daily-dns-check", { pattern: "0 3 * * *" }, { name: "all", data: {} });
  // Campaign scheduler: allocate inbox capacity to due leads every minute.
  await getQueue(QUEUES.scheduler).upsertJobScheduler("campaign-tick", { every: 60_000 }, { name: "tick", data: {} });
  // Reply detection: poll every inbox over IMAP every 5 minutes.
  await getQueue(QUEUES.fetchReplies).upsertJobScheduler("imap-fanout", { every: 5 * 60_000 }, { name: "fanout", data: { fanout: true } });
  // Warm-up planner: every 15 minutes during the active window.
  await getQueue(QUEUES.warmup).upsertJobScheduler("warmup-plan", { every: 15 * 60_000 }, { name: "plan", data: { plan: true } });
}

async function main() {
  const only = process.env.WORKERS?.split(",").map((s) => s.trim());
  const all: Record<string, () => Worker> = {
    scheduler: startSchedulerWorker,
    send: startSendWorker,
    replies: startFetchRepliesWorker,
    warmup: startWarmupWorker,
    webhooks: startWebhookWorker,
    dns: startDnsCheckWorker,
    placement: startPlacementWorker,
    ai: startAiWorker,
  };
  // WORKERS=send,replies lets you scale each queue as its own process.
  const workers: Worker[] = Object.entries(all)
    .filter(([name]) => !only || only.includes(name))
    .map(([, start]) => start());

  for (const w of workers) {
    w.on("failed", (job, err) => logger.error("job failed", { queue: w.name, jobId: job?.id, err: err.message }));
  }
  await scheduleRepeatables();
  logger.info("workers started", { queues: workers.map((w) => w.name) });

  const shutdown = async () => {
    logger.info("shutting down");
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error("worker boot failed", { err: String(e) });
  process.exit(1);
});
