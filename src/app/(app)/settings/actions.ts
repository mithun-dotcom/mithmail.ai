"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { requireWorkspace } from "@/server/workspace";
import { WEBHOOK_EVENTS } from "@/server/services/webhooks";

export type Result = { ok?: boolean; error?: string; message?: string; secret?: string };

export async function renameWorkspace(formData: FormData) {
  const { workspace } = await requireWorkspace("ADMIN");
  const name = z.string().trim().min(2).max(60).parse(formData.get("name"));
  const updated = await db.workspace.update({ where: { id: workspace.id }, data: { name } });
  const { renameSalesblinkWorkspace } = await import("@/server/salesblink/provisioning");
  await renameSalesblinkWorkspace(updated).catch(() => undefined);
  revalidatePath("/", "layout");
}

// ---- Team -----------------------------------------------------------------

export async function inviteMember(_: Result, formData: FormData): Promise<Result> {
  const { workspace } = await requireWorkspace("ADMIN");
  const p = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["ADMIN", "VIEWER"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Enter a valid email." };
  // Users sign in with the same email (Google / Microsoft / magic link) and the membership is already there.
  const user = await db.user.upsert({ where: { email: p.data.email }, create: { email: p.data.email }, update: {} });
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    create: { workspaceId: workspace.id, userId: user.id, role: p.data.role },
    update: { role: p.data.role },
  });
  revalidatePath("/settings");
  return { ok: true, message: `${p.data.email} can now sign in to this workspace.` };
}

export async function removeMember(memberId: string) {
  const { workspace, user } = await requireWorkspace("ADMIN");
  const m = await db.workspaceMember.findFirstOrThrow({ where: { id: memberId, workspaceId: workspace.id } });
  if (m.role === "OWNER") throw new Error("The owner cannot be removed.");
  if (m.userId === user.id) throw new Error("You cannot remove yourself.");
  await db.workspaceMember.delete({ where: { id: memberId } });
  revalidatePath("/settings");
}

// ---- Blocklist ------------------------------------------------------------

export async function addToBlocklist(_: Result, formData: FormData): Promise<Result> {
  const { workspace } = await requireWorkspace("ADMIN");
  const entries = String(formData.get("entries") ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase().replace(/^@/, ""))
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(e));
  if (!entries.length) return { error: "Enter emails or domains, one per line." };
  const res = await db.globalBlocklist.createMany({
    data: [...new Set(entries)].map((emailOrDomain) => ({ workspaceId: workspace.id, emailOrDomain })),
    skipDuplicates: true,
  });
  // Stop any in-progress sequences for newly blocked leads.
  const emails = entries.filter((e) => e.includes("@"));
  const domains = entries.filter((e) => !e.includes("@"));
  await db.campaignLead.updateMany({
    where: {
      status: "ACTIVE",
      campaign: { workspaceId: workspace.id },
      lead: { OR: [{ email: { in: emails } }, ...domains.map((d) => ({ email: { endsWith: `@${d}` } }))] },
    },
    data: { status: "FINISHED", nextSendAt: null },
  });
  if (workspace.sendingEngine === "SALESBLINK") {
    // SalesBlink checks its own blocklist before every send.
    const { clientFor } = await import("@/server/salesblink/service");
    await clientFor(workspace).addToBlocklist([...new Set(entries)]).catch(() => undefined);
  }
  revalidatePath("/settings");
  return { ok: true, message: `Added ${res.count} entries.` };
}

export async function removeFromBlocklist(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.globalBlocklist.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}

// ---- API keys -------------------------------------------------------------

export async function createApiKey(_: Result, formData: FormData): Promise<Result> {
  const { workspace } = await requireWorkspace("ADMIN");
  const name = z.string().trim().min(1).max(60).safeParse(formData.get("name"));
  if (!name.success) return { error: "Name the key." };
  const key = `mm_live_${randomToken(24)}`;
  await db.apiKey.create({ data: { workspaceId: workspace.id, name: name.data, prefix: key.slice(0, 12), keyHash: sha256(key) } });
  revalidatePath("/settings");
  return { ok: true, secret: key, message: "Copy this key now — it won't be shown again." };
}

export async function revokeApiKey(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.apiKey.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}

// ---- Webhooks -------------------------------------------------------------

export async function createWebhook(_: Result, formData: FormData): Promise<Result> {
  const { workspace } = await requireWorkspace("ADMIN");
  const url = z.string().url().refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "Webhook URLs must use HTTPS").safeParse(formData.get("url"));
  if (!url.success) return { error: url.error.issues[0]?.message ?? "Invalid URL" };
  const events = formData.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) return { error: "Pick at least one event." };
  const secret = `whsec_${randomToken(24)}`;
  await db.webhook.create({ data: { workspaceId: workspace.id, url: url.data, events, secretEnc: encrypt(secret) } });
  revalidatePath("/settings");
  return { ok: true, secret, message: "Signing secret — verify the x-mithmill-signature header with it. Shown once." };
}

export async function deleteWebhook(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.webhook.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}

export async function toggleWebhook(id: string, isActive: boolean) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.webhook.updateMany({ where: { id, workspaceId: workspace.id }, data: { isActive } });
  revalidatePath("/settings");
}

// ---- SalesBlink: one SalesBlink workspace per MithMill workspace -------------

export async function createSalesblinkWorkspaceAction(): Promise<Result> {
  const { workspace } = await requireWorkspace("OWNER");
  const { createSalesblinkWorkspace } = await import("@/server/salesblink/provisioning");
  try {
    const res = await createSalesblinkWorkspace(workspace.id);
    if (!res) return { error: "No platform SalesBlink key is configured yet." };
    revalidatePath("/settings");
    return { ok: true, message: `Created SalesBlink workspace "${res.name}". Now create an API key inside it (step 2).` };
  } catch (e) {
    return { error: `SalesBlink: ${(e as Error).message}` };
  }
}

export async function linkSalesblinkKeyAction(_: Result, formData: FormData): Promise<Result> {
  const { workspace } = await requireWorkspace("OWNER");
  const { linkWorkspaceKey, LinkKeyError } = await import("@/server/salesblink/provisioning");
  try {
    await linkWorkspaceKey(workspace.id, String(formData.get("apiKey") ?? ""));
  } catch (e) {
    return { error: e instanceof LinkKeyError ? e.message : `Could not link: ${(e as Error).message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Linked. This workspace now sends through its SalesBlink workspace — its inboxes are being imported." };
}

export async function useMainSalesblinkWorkspaceAction(): Promise<Result> {
  const { workspace } = await requireWorkspace("OWNER");
  const { linkMainSalesblinkWorkspace, LinkKeyError } = await import("@/server/salesblink/provisioning");
  try {
    await linkMainSalesblinkWorkspace(workspace.id);
  } catch (e) {
    return { error: e instanceof LinkKeyError ? e.message : (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Linked to your main SalesBlink workspace." };
}

export async function unlinkSalesblinkAction(): Promise<Result> {
  const { workspace } = await requireWorkspace("OWNER");
  const { unlinkWorkspace } = await import("@/server/salesblink/provisioning");
  await unlinkWorkspace(workspace.id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Unlinked. New campaigns use the built-in engine; campaigns already on SalesBlink stop syncing." };
}

export async function savePlatformKeyAction(_: Result, formData: FormData): Promise<Result> {
  const { user } = await requireWorkspace("OWNER");
  const me = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (me.role !== "SUPER_ADMIN") return { error: "Only the platform admin can set the SalesBlink owner key." };
  const key = String(formData.get("ownerKey") ?? "").trim();
  if (!key) return { error: "Paste your SalesBlink owner API key." };
  const { savePlatformOwnerKey } = await import("@/server/salesblink/provisioning");
  try {
    await savePlatformOwnerKey(key);
  } catch (e) {
    return { error: `SalesBlink rejected the key: ${(e as Error).message}` };
  }
  revalidatePath("/settings");
  return { ok: true, message: "Saved. New MithMill workspaces now get their own SalesBlink workspace automatically." };
}

export async function syncSalesblinkNow(): Promise<Result> {
  const { workspace } = await requireWorkspace("ADMIN");
  if (!workspace.salesblinkApiKeyEnc) return { error: "Link this workspace to SalesBlink first." };
  const { getQueue, QUEUES } = await import("@/server/queue");
  await db.workspace.update({ where: { id: workspace.id }, data: { salesblinkSyncState: { ...((workspace.salesblinkSyncState as object) ?? {}), sendersAt: 0 } } });
  await getQueue(QUEUES.salesblink).add("sync", { kind: "sync", workspaceId: workspace.id }, { jobId: `sb-sync-manual-${workspace.id}-${Math.floor(Date.now() / 60_000)}` });
  return { ok: true, message: "Sync started — inboxes, activity and replies refresh in a minute." };
}
