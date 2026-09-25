import { Queue, type ConnectionOptions } from "bullmq";

// BullMQ reserves ":" as its key separator, so the PRD's `queue:send-email`
// style names are expressed as plain names here.
export const QUEUES = {
  sendEmail: "send-email",
  fetchReplies: "fetch-replies",
  warmup: "warmup-sync",
  dnsCheck: "dns-check",
  scheduler: "campaign-scheduler",
  webhooks: "webhooks",
  placement: "placement-test",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const globalForQueues = globalThis as unknown as { mmQueues?: Map<string, Queue> };
const queues = (globalForQueues.mmQueues ??= new Map());

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    });
    queues.set(name, q);
  }
  return q;
}

// ---- Job payloads ----------------------------------------------------------

export interface SendEmailJob {
  emailLogId: string;
}
export interface SchedulerJob {
  tick?: number;
}
export interface FetchRepliesJob {
  emailAccountId: string;
}
export interface DnsCheckJob {
  emailAccountId?: string; // omit = all accounts
}
export interface WarmupJob {
  kind: "send" | "reply";
  senderAccountId: string;
  recipientAccountId?: string;
  warmupLogId?: string;
}
export interface PlacementJob {
  kind: "check";
  testId: string;
  attempt: number;
}
export interface WebhookJob {
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
}

let sharedRedis: import("ioredis").Redis | null = null;
/** Plain ioredis client for app-level keys (pacing, locks). */
export async function redis() {
  if (!sharedRedis) {
    const { Redis } = await import("ioredis");
    sharedRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 3 });
  }
  return sharedRedis;
}
