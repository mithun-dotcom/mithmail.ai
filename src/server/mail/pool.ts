import type { Transporter } from "nodemailer";
import type { EmailAccount } from "@prisma/client";
import { createSmtpTransport } from "./clients";

const transports = new Map<string, { t: Transporter; updatedAt: number; createdAt: number }>();

/** Cached SMTP transport per inbox; rebuilt when the account changes or an OAuth token may have expired. */
export async function transportFor(account: EmailAccount): Promise<Transporter> {
  const cached = transports.get(account.id);
  const fresh = account.provider === "SMTP" || !account.oauthRefreshTokenEnc || Date.now() - (cached?.createdAt ?? 0) < 45 * 60_000;
  if (cached && cached.updatedAt === account.updatedAt.getTime() && fresh) return cached.t;
  cached?.t.close();
  const t = await createSmtpTransport(account);
  transports.set(account.id, { t, updatedAt: account.updatedAt.getTime(), createdAt: Date.now() });
  return t;
}

export function dropTransport(accountId: string) {
  transports.get(accountId)?.t.close();
  transports.delete(accountId);
}
