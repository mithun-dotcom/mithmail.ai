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
import { clientFor, importSenderByEmail, pushSenderSettings, syncSenders } from "@/server/salesblink/service";
import { getQueue, QUEUES } from "@/server/queue";

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

  if (workspace.sendingEngine === "SALESBLINK") {
    // SalesBlink holds the credentials and verifies the connection itself.
    try {
      await clientFor(workspace).addSender({
        from_email: d.emailAddress,
        from_name: d.fromName || undefined,
        user_name: d.smtpUser,
        password: d.smtpPass,
        smtp_host: d.smtpHost,
        smtp_port: d.smtpPort,
        imap_host: d.imapHost,
        imap_port: d.imapPort,
        imap_user_name: d.imapUser || d.smtpUser,
        imap_password: d.imapPass || d.smtpPass,
        warmup_enabled: true,
        auto_ramp_up_enabled: true,
        sequence_max_daily_frequency: d.dailyLimit,
      });
      await syncSenders(workspace.id, { healthBudget: 3 });
    } catch (e) {
      return { error: `SalesBlink: ${(e as Error).message}` };
    }
    const acct = await db.emailAccount.findUnique({ where: { workspaceId_emailAddress: { workspaceId: workspace.id, emailAddress: d.emailAddress } } });
    revalidatePath("/accounts");
    if (acct) redirect(`/accounts/${acct.id}`);
    return { ok: true, message: "Added to SalesBlink. It will appear here once SalesBlink finishes connecting it." };
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
  if (workspace.sendingEngine === "SALESBLINK") {
    // Hand the whole batch to this workspace's SalesBlink workspace.
    const cols = ["from_email", "password", "smtp_host", "smtp_port", "from_name", "user_name", "imap_host", "imap_port", "imap_user_name", "imap_password", "warmup_enabled", "sequence_max_daily_frequency"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = rows
      .filter((r) => r.email && r.smtp_host && r.smtp_pass)
      .map((r) =>
        [r.email, r.smtp_pass, r.smtp_host, r.smtp_port || "587", r.from_name ?? "", r.smtp_user || r.email, r.imap_host ?? "", r.imap_port || "993", r.imap_user || r.smtp_user || r.email, r.imap_pass || r.smtp_pass, "true", r.daily_limit || "30"]
          .map((v) => esc(String(v)))
          .join(","),
      );
    if (!lines.length) return { error: "No valid rows (email, smtp_host and smtp_pass are required)." };
    try {
      await clientFor(workspace).addBulkSenders([cols.join(","), ...lines].join("\n"));
      await getQueue(QUEUES.salesblink).add("sync-senders", { kind: "sync-senders", workspaceId: workspace.id }, { delay: 120_000 });
    } catch (e) {
      return { error: `SalesBlink: ${(e as Error).message}` };
    }
    return { ok: true, message: `Sent ${lines.length} inboxes to SalesBlink. They'll appear here once SalesBlink connects them (a few minutes).` };
  }
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
  const { workspace, account } = await ownAccount(id);
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
      ...(d.isWarmupEnabled === "on" && !account.warmupStartedAt ? { warmupStartedAt: new Date() } : {}),
      warmupDailyLimit: d.warmupDailyLimit,
      warmupRampUp: d.warmupRampUp,
      warmupReplyRate: d.warmupReplyRate,
      trackingDomainId,
    },
  });
  const updated = await db.emailAccount.findUniqueOrThrow({ where: { id } });
  if (updated.salesblinkSenderId) {
    try {
      await pushSenderSettings(updated);
    } catch (e) {
      return { error: `Saved in MithMill, but SalesBlink rejected the update: ${(e as Error).message}` };
    }
  }
  if (d.dkimSelector !== undefined) {
    await db.domainHealth.updateMany({ where: { emailAccountId: id }, data: { dkimSelector: d.dkimSelector || null } });
  }
  revalidatePath(`/accounts/${id}`);
  revalidatePath("/accounts");
  return { ok: true, message: "Saved." };
}

export async function testAccount(id: string): Promise<ActionState> {
  const { account, workspace } = await ownAccount(id);
  if (account.salesblinkSenderId) {
    try {
      const client = clientFor(workspace);
      await client.reconnectSender(account.salesblinkSenderId);
      const { refreshSenderHealth } = await import("@/server/salesblink/service");
      await refreshSenderHealth(client, account);
    } catch (e) {
      return { error: `SalesBlink: ${(e as Error).message}` };
    }
    revalidatePath(`/accounts/${id}`);
    return { ok: true, message: "Reconnect requested in SalesBlink. Health refreshed." };
  }
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

export async function syncSalesblinkAccounts(): Promise<ActionState> {
  const { workspace } = await requireWorkspace("ADMIN");
  try {
    const r = await syncSenders(workspace.id, { healthBudget: 10 });
    revalidatePath("/accounts");
    return { ok: true, message: `Synced ${r.senders} SalesBlink inboxes.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteAccount(id: string) {
  await ownAccount(id);
  await db.emailAccount.delete({ where: { id } });
  revalidatePath("/accounts");
  redirect("/accounts");
}

/** Snapshot of SalesBlink sender ids, taken when the user starts a Google / Outlook sign-in. */
export async function salesblinkSenderBaseline(): Promise<string[]> {
  const { workspace } = await requireWorkspace("ADMIN");
  try {
    return (await clientFor(workspace).listSenders()).map((s) => s.id);
  } catch {
    return [];
  }
}

/**
 * Polled by the Connect Google / Outlook popup flow: one GET /senders per call. A sender that
 * wasn't in the baseline is the one just connected — import it and return its account id.
 */
export async function checkNewSalesblinkInbox(baseline: string[]): Promise<{ accountId?: string; email?: string; error?: string }> {
  const { workspace } = await requireWorkspace("ADMIN");
  try {
    const before = new Set(baseline);
    const fresh = (await clientFor(workspace).listSenders()).find((s) => !before.has(s.id));
    if (!fresh) return {};
    await syncSenders(workspace.id, { healthBudget: 3 });
    const account = await db.emailAccount.findUnique({ where: { workspaceId_salesblinkSenderId: { workspaceId: workspace.id, salesblinkSenderId: fresh.id } } });
    revalidatePath("/accounts");
    return { accountId: account?.id, email: fresh.email };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Pulls one inbox that's already connected in SalesBlink into MithMill, by its email address. */
export async function importSalesblinkInbox(email: string): Promise<ActionState & { accountId?: string }> {
  const { workspace } = await requireWorkspace("ADMIN");
  const parsed = z.string().trim().email().safeParse(email);
  if (!parsed.success) return { error: "Enter a valid email address." };
  try {
    const account = await importSenderByEmail(workspace.id, parsed.data);
    if (!account) return { error: `${parsed.data} isn't in this workspace's SalesBlink workspace yet. Connect it first, then try again.` };
    revalidatePath("/accounts");
    return { ok: true, message: `Imported ${account.emailAddress}.`, accountId: account.id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
