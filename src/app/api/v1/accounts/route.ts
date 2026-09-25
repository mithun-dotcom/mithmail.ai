import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-auth";

export const GET = apiHandler(async (_req, ws) =>
  db.emailAccount.findMany({
    where: { workspaceId: ws.id },
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      status: true,
      dailyLimit: true,
      isWarmupEnabled: true,
      lastError: true,
      domainHealth: { select: { domain: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, mxStatus: true, lastCheckedAt: true } },
    },
  }),
);
