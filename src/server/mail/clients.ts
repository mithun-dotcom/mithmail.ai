import nodemailer, { type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import type { EmailAccount } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { getAccessToken } from "./oauth";
import { PROVIDER_PRESETS } from "./presets";

function isOAuth(account: EmailAccount) {
  return account.provider !== "SMTP" && !!account.oauthRefreshTokenEnc;
}

function hosts(account: EmailAccount) {
  const preset = account.provider === "SMTP" ? undefined : PROVIDER_PRESETS[account.provider];
  return {
    smtpHost: account.smtpHost ?? preset?.smtpHost,
    smtpPort: account.smtpPort ?? preset?.smtpPort ?? 587,
    imapHost: account.imapHost ?? preset?.imapHost,
    imapPort: account.imapPort ?? preset?.imapPort ?? 993,
  };
}

export async function createSmtpTransport(account: EmailAccount): Promise<Transporter> {
  const { smtpHost, smtpPort } = hosts(account);
  if (!smtpHost) throw new Error("SMTP host missing");
  const user = account.smtpUser ?? account.emailAddress;

  const auth = isOAuth(account)
    ? { type: "OAuth2" as const, user, accessToken: await getAccessToken(account) }
    : { user, pass: account.smtpPassEnc ? decrypt(account.smtpPassEnc) : "" };

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: smtpPort === 587,
    auth,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

export async function createImapClient(account: EmailAccount): Promise<ImapFlow> {
  const { imapHost, imapPort } = hosts(account);
  if (!imapHost) throw new Error("IMAP host missing");
  const user = account.imapUser ?? account.emailAddress;

  const auth = isOAuth(account)
    ? { user, accessToken: await getAccessToken(account) }
    : { user, pass: account.imapPassEnc ? decrypt(account.imapPassEnc) : "" };

  return new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: imapPort === 993,
    auth,
    logger: false,
    socketTimeout: 60_000,
  });
}

/** Verifies SMTP + IMAP credentials. Returns a list of human-readable errors (empty = OK). */
export async function testConnection(account: EmailAccount): Promise<string[]> {
  const errors: string[] = [];
  try {
    const transport = await createSmtpTransport(account);
    await transport.verify();
    transport.close();
  } catch (e) {
    errors.push(`SMTP: ${(e as Error).message}`);
  }
  try {
    const client = await createImapClient(account);
    await client.connect();
    await client.logout();
  } catch (e) {
    errors.push(`IMAP: ${(e as Error).message}`);
  }
  return errors;
}
