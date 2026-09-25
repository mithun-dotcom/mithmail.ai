import { UnrecoverableError, Worker } from "bullmq";
import { QUEUES, redisConnection, type SchedulerJob, type SendEmailJob, type WebhookJob } from "@/server/queue";
import { processSendJob, RetryableSendError } from "@/server/sending/sender";
import { runSchedulerTick } from "@/server/sending/scheduler";
import { deliverWebhook } from "@/server/services/webhooks";
import { logger } from "./logger";

export function startSendWorker() {
  return new Worker<SendEmailJob>(
    QUEUES.sendEmail,
    async (job) => {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      try {
        const res = await processSendJob(job.data.emailLogId, final);
        logger.info("send", { log: job.data.emailLogId, res });
        return res;
      } catch (e) {
        if (e instanceof RetryableSendError) throw e;
        // Unknown errors (DB down, bug): let BullMQ retry, but don't loop forever.
        if (final) throw new UnrecoverableError((e as Error).message);
        throw e;
      }
    },
    { connection: redisConnection(), concurrency: Number(process.env.SEND_CONCURRENCY ?? 10) },
  );
}

export function startSchedulerWorker() {
  return new Worker<SchedulerJob>(
    QUEUES.scheduler,
    async () => {
      const res = await runSchedulerTick();
      if (res.queued || res.completed) logger.info("scheduler tick", res);
      return res;
    },
    // Single consumer: the tick is the only place inbox capacity is allocated.
    { connection: redisConnection(), concurrency: 1 },
  );
}

export function startWebhookWorker() {
  return new Worker<WebhookJob>(QUEUES.webhooks, (job) => deliverWebhook(job.data), { connection: redisConnection(), concurrency: 5 });
}
