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
  await db.workspace.update({ where: { id: workspace.id }, data: { name } });
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

// ---- Sending engine (SalesBlink) --------------------------------------------

export async function saveSendingEngine(_: Result, formData: FormData): Promise<Result> {
  const { workspace } = await requireWorkspace("OWNER");
  const engine = z.enum(["BUILTIN", "SALESBLINK"]).parse(formData.get("engine"));
  const newKey = String(formData.get("apiKey") ?? "").trim();

  const data: { sendingEngine: "BUILTIN" | "SALESBLINK"; salesblinkApiKeyEnc?: string } = { sendingEngine: engine };

  if (engine === "SALESBLINK") {
    const { SalesBlinkClient } = await import("@/server/salesblink/client");
    const { salesblinkKey } = await import("@/server/salesblink/service");
    const key = newKey || salesblinkKey(workspace);
    if (!key) return { error: "Enter your SalesBlink API key (run.salesblink.io → Account → Integration → API)." };
    try {
      await new SalesBlinkClient(key).verify();
    } catch (e) {
      return { error: `SalesBlink rejected the key: ${(e as Error).message}` };
    }
    // Only a verified key is stored.
    if (newKey) data.salesblinkApiKeyEnc = encrypt(newKey);
  }
  await db.workspace.update({ where: { id: workspace.id }, data });
  if (engine === "SALESBLINK") {
    const { getQueue, QUEUES } = await import("@/server/queue");
    await getQueue(QUEUES.salesblink).add("sync-senders", { kind: "sync-senders", workspaceId: workspace.id }, { attempts: 2 });
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      engine === "SALESBLINK"
        ? "SalesBlink connected. Your SalesBlink inboxes are being imported; new campaigns will send through SalesBlink."
        : "Using MithMill's built-in engine for new campaigns.",
  };
}

export async function syncSalesblinkNow(): Promise<Result> {
  const { workspace } = await requireWorkspace("ADMIN");
  if (workspace.sendingEngine !== "SALESBLINK") return { error: "SalesBlink is not the sending engine for this workspace." };
  const { getQueue, QUEUES } = await import("@/server/queue");
  await getQueue(QUEUES.salesblink).add("sync", { kind: "sync", workspaceId: workspace.id }, { jobId: `sb-sync-manual-${workspace.id}-${Math.floor(Date.now() / 60_000)}` });
  await db.workspace.update({ where: { id: workspace.id }, data: { salesblinkSyncState: { ...((workspace.salesblinkSyncState as object) ?? {}), sendersAt: 0 } } });
  return { ok: true, message: "Sync started — inboxes, activity and replies will refresh in a minute." };
}
