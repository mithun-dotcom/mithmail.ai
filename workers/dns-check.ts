import { Worker } from "bullmq";
import { QUEUES, redisConnection, type DnsCheckJob } from "@/server/queue";
import { refreshAllDomainHealth, refreshDomainHealth } from "@/server/services/domain-health";
import { db } from "@/lib/db";
import { verifyCname } from "@/lib/dns";
import { logger } from "./logger";

export function startDnsCheckWorker() {
  return new Worker<DnsCheckJob>(
    QUEUES.dnsCheck,
    async (job) => {
      if (job.data.emailAccountId) {
        await refreshDomainHealth(job.data.emailAccountId);
        return { accounts: 1 };
      }
      const res = await refreshAllDomainHealth();

      // Tracking domains can lose their CNAME too.
      const target = process.env.TRACKING_CNAME_TARGET ?? "track.mithmill.app";
      for (const td of await db.trackingDomain.findMany()) {
        const ok = await verifyCname(td.domainName, target);
        await db.trackingDomain.update({ where: { id: td.id }, data: { cnameVerified: ok, lastCheckedAt: new Date() } });
      }
      logger.info("dns-check complete", res);
      return res;
    },
    { connection: redisConnection(), concurrency: 2 },
  );
}
