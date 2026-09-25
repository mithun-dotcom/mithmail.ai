"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { EmailAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireWorkspace } from "@/server/workspace";
import { testConnection } from "@/server/mail/clients";
import { refreshDomainHealth } from "@/server/services/domain-health";

export type ActionState = { ok?: boolean; error?: string; message?: string };

const smtpSchema = z.object({
  emailAddress: z.string().trim().toLowerCase().email(),
  fromName: z.string().trim().max(80).optional(),
  provider: z.enum(["GOOGLE", "MICROSOFT", "SMTP"]),
  smtpHost: z.string().trim().min(3),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUser: z.string().trim().min(1),
  smtpPass: z.string().min(1),
  imapHost: z.string().trim().min(3),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapUser: z.string().trim().optional(),
  imapPass: z.string().optional(),
  dailyLimit: z.coerce.number().int().min(1).max(500).default(30),
  skipTest: z.string().optional(),
});

async function assertCapacity(workspaceId: string, maxInboxes: number, adding = 1) {
  const count = await db.emailAccount.count({ where: { workspaceId } });
  if (count + adding > maxInboxes) {
    throw new Error(`Your plan allows ${maxInboxes} inboxes. Upgrade to connect more.`);
  }
}

export async function addSmtpAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const { workspace } = await requireWorkspace("ADMIN");
  const parsed = smtpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const d = parsed.data;

  try {
    await assertCapacity(workspace.id, workspace.maxInboxes);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (await db.emailAccount.findUnique({ where: { workspaceId_emailAddress: { workspaceId: workspace.id, emailAddress: d.emailAddress } } })) {
    return { error: "This inbox is already connected." };
  }

  const data = {
    workspaceId: workspace.id,
    emailAddress: d.emailAddress,
    fromName: d.fromName || null,
    provider: d.provider,
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpUser: d.smtpUser,
    smtpPassEnc: encrypt(d.smtpPass),
    imapHost: d.imapHost,
    imapPort: d.imapPort,
    imapUser: d.imapUser || d.smtpUser,
    imapPassEnc: encrypt(d.imapPass || d.smtpPass),
    dailyLimit: d.dailyLimit,
  };

  if (!d.skipTest) {
    const errors = await testConnection({ ...data, id: "test" } as EmailAccount);
    if (errors.length) return { error: `Connection test failed. ${errors.join(" · ")}` };
  }

  const account = await db.emailAccount.create({ data });
  await refreshDomainHealth(account.id).catch(() => undefined);
  revalidatePath("/accounts");
  redirect(`/accounts/${account.id}`);
}

const bulkRow = z.object({
  email: z.string().trim().toLowerCase().email(),
  from_name: z.string().optional(),
  smtp_host: z.string().min(3),
  smtp_port: z.coerce.number().int(),
  smtp_user: z.string().optional(),
  smtp_pass: z.string().min(1),
  imap_host: z.string().min(3),
  imap_port: z.coerce.number().int(),
  imap_user: z.string().optional(),
  imap_pass: z.string().optional(),
  daily_limit: z.coerce.number().int().optional(),
});

/** Bulk import from CSV rows (parsed client-side). Rows are stored without a live connection test. */
export async function bulkImportAccounts(rows: Record<string, string>[]): Promise<ActionState> {
  const { workspace } = await requireWorkspace("ADMIN");
  const valid: z.infer<typeof bulkRow>[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const p = bulkRow.safeParse(r);
    if (p.success) valid.push(p.data);
    else errors.push(`Row ${i + 2}: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`);
  });
  try {
    await assertCapacity(workspace.id, workspace.maxInboxes, valid.length);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const res = await db.emailAccount.createMany({
    skipDuplicates: true,
    data: valid.map((r) => ({
      workspaceId: workspace.id,
      emailAddress: r.email,
      fromName: r.from_name || null,
      provider: "SMTP" as const,
      smtpHost: r.smtp_host,
      smtpPort: r.smtp_port,
      smtpUser: r.smtp_user || r.email,
      smtpPassEnc: encrypt(r.smtp_pass),
      imapHost: r.imap_host,
      imapPort: r.imap_port,
      imapUser: r.imap_user || r.smtp_user || r.email,
      imapPassEnc: encrypt(r.imap_pass || r.smtp_pass),
      dailyLimit: r.daily_limit ?? 30,
    })),
  });
  revalidatePath("/accounts");
  return {
    ok: true,
    message: `Imported ${res.count} inboxes.${errors.length ? ` Skipped ${errors.length}: ${errors.slice(0, 3).join("; ")}` : ""}`,
  };
}

const settingsSchema = z.object({
  fromName: z.string().trim().max(80).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(500),
  minDelaySeconds: z.coerce.number().int().min(0).max(3600),
  maxDelaySeconds: z.coerce.number().int().min(0).max(7200),
  signature: z.string().max(5000).optional(),
  isWarmupEnabled: z.string().optional(),
  warmupDailyLimit: z.coerce.number().int().min(1).max(100),
  warmupRampUp: z.coerce.number().int().min(1).max(20),
  warmupReplyRate: z.coerce.number().int().min(0).max(100),
  trackingDomainId: z.string().optional(),
  dkimSelector: z.string().trim().max(63).optional(),
});

async function ownAccount(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  const account = await db.emailAccount.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!account) throw new Error("Account not found");
  return { account, workspace };
}

export async function updateAccount(id: string, _: ActionState, formData: FormData): Promise<ActionState> {
  const { workspace } = await ownAccount(id);
  const p = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const d = p.data;
  if (d.maxDelaySeconds < d.minDelaySeconds) return { error: "Max delay must be ≥ min delay." };

  let trackingDomainId: string | null = null;
  if (d.trackingDomainId) {
    const td = await db.trackingDomain.findFirst({ where: { id: d.trackingDomainId, workspaceId: workspace.id } });
    trackingDomainId = td?.id ?? null;
  }
  await db.emailAccount.update({
    where: { id },
    data: {
      fromName: d.fromName || null,
      dailyLimit: d.dailyLimit,
      minDelaySeconds: d.minDelaySeconds,
      maxDelaySeconds: d.maxDelaySeconds,
      signature: d.signature || null,
      isWarmupEnabled: d.isWarmupEnabled === "on",
      warmupDailyLimit: d.warmupDailyLimit,
      warmupRampUp: d.warmupRampUp,
      warmupReplyRate: d.warmupReplyRate,
      trackingDomainId,
    },
  });
  if (d.dkimSelector !== undefined) {
    await db.domainHealth.updateMany({ where: { emailAccountId: id }, data: { dkimSelector: d.dkimSelector || null } });
  }
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true, message: "Saved." };
}

export async function testAccount(id: string): Promise<ActionState> {
  const { account } = await ownAccount(id);
  const errors = await testConnection(account);
  await db.emailAccount.update({
    where: { id },
    data: errors.length ? { status: "ERROR", lastError: errors.join(" · ") } : { status: account.status === "ERROR" ? "ACTIVE" : account.status, lastError: null },
  });
  revalidatePath(`/accounts/${id}`);
  return errors.length ? { error: errors.join(" · ") } : { ok: true, message: "SMTP and IMAP connected successfully." };
}

export async function recheckDns(id: string): Promise<ActionState> {
  await ownAccount(id);
  await refreshDomainHealth(id);
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  revalidatePath("/deliverability");
  return { ok: true, message: "DNS re-checked." };
}

export async function setAccountStatus(id: string, status: "ACTIVE" | "PAUSED") {
  await ownAccount(id);
  await db.emailAccount.update({ where: { id }, data: { status } });
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${id}`);
}

export async function deleteAccount(id: string) {
  await ownAccount(id);
  await db.emailAccount.delete({ where: { id } });
  revalidatePath("/accounts");
  redirect("/accounts");
}
