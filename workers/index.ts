import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import type { Worker } from "bullmq";
import { getQueue, QUEUES } from "@/server/queue";
import { startDnsCheckWorker } from "./dns-check";
import { logger } from "./logger";

async function scheduleRepeatables() {
  // Daily DNS audit at 03:00 UTC.
  await getQueue(QUEUES.dnsCheck).upsertJobScheduler("daily-dns-check", { pattern: "0 3 * * *" }, { name: "all", data: {} });
}

async function main() {
  const workers: Worker[] = [startDnsCheckWorker()];

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
