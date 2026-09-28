/**
 * One SalesBlink workspace per MithMill workspace.
 *
 * SalesBlink API keys are bound to a single SalesBlink workspace and can only be created
 * in SalesBlink's web UI. So:
 *   1. The platform owner key (SalesBlink account owner) creates a SalesBlink workspace
 *      whenever a MithMill workspace is created.
 *   2. Once, per workspace, the owner creates an API key inside that SalesBlink workspace
 *      (MithMill hands out a login link to the API-keys page) and pastes it into MithMill.
 *   3. From then on every call for that MithMill workspace uses its own key, so inboxes,
 *      lists, sequences and replies live in the matching SalesBlink workspace.
 */
import type { Workspace } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt, sha256 } from "@/lib/crypto";
import { getQueue, QUEUES } from "@/server/queue";
import { SalesBlinkClient, SalesBlinkError } from "./client";

const OWNER_KEY_SETTING = "salesblink_owner_key";

/** Platform owner key: SALESBLINK_API_KEY env, or the one a super-admin saved in the app. */
export async function platformOwnerKey(): Promise<string | null> {
  if (process.env.SALESBLINK_API_KEY) return process.env.SALESBLINK_API_KEY;
  const row = await db.platformSetting.findUnique({ where: { key: OWNER_KEY_SETTING } });
  return row ? decrypt(row.valueEnc) : null;
}

export async function platformClient(): Promise<SalesBlinkClient | null> {
  const key = await platformOwnerKey();
  return key ? new SalesBlinkClient(key) : null;
}

export async function savePlatformOwnerKey(key: string) {
  await new SalesBlinkClient(key).verify();
  await db.platformSetting.upsert({
    where: { key: OWNER_KEY_SETTING },
    create: { key: OWNER_KEY_SETTING, valueEnc: encrypt(key) },
    update: { valueEnc: encrypt(key) },
  });
}

/** SalesBlink needs names of at least 4 characters. */
export function salesblinkWorkspaceName(name: string) {
  const n = name.trim();
  return n.length >= 4 ? n.slice(0, 80) : `${n} workspace`;
}

/** Creates the matching SalesBlink workspace (idempotent). Returns null when no platform key is configured. */
export async function createSalesblinkWorkspace(workspaceId: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (ws.salesblinkWorkspaceId) return { id: ws.salesblinkWorkspaceId, name: ws.salesblinkWorkspaceName ?? ws.name };
  const client = await platformClient();
  if (!client) return null;
  const name = salesblinkWorkspaceName(ws.name);
  const res = await client.request<{ data: { id: string; name: string } }>("POST", "/workspaces", { json: { name } });
  await db.workspace.update({
    where: { id: ws.id },
    data: { salesblinkWorkspaceId: res.data.id, salesblinkWorkspaceName: res.data.name ?? name, sendingEngine: "SALESBLINK" },
  });
  return res.data;
}

export async function renameSalesblinkWorkspace(ws: Pick<Workspace, "salesblinkWorkspaceId" | "name">) {
  if (!ws.salesblinkWorkspaceId) return;
  const client = await platformClient();
  if (!client) return;
  await client.request("PATCH", `/workspaces/${encodeURIComponent(ws.salesblinkWorkspaceId)}`, { json: { name: salesblinkWorkspaceName(ws.name) } });
  await db.workspace.updateMany({ where: { salesblinkWorkspaceId: ws.salesblinkWorkspaceId }, data: { salesblinkWorkspaceName: salesblinkWorkspaceName(ws.name) } });
}

/** Magic login link to SalesBlink's API-keys page (platform owner's session). */
export async function apiKeysLoginLink(): Promise<string> {
  const client = await platformClient();
  if (!client) throw new Error("No platform SalesBlink key is configured.");
  const res = await client.request<{ data: { login_link: string } }>("GET", "/keys/create-link");
  return res.data.login_link;
}

export class LinkKeyError extends Error {}

/**
 * Stores the API key of this workspace's SalesBlink workspace. Refuses keys that are already
 * linked to another MithMill workspace (and, unless allowed, the platform owner key itself),
 * which is what keeps clients' data apart.
 */
export async function linkWorkspaceKey(workspaceId: string, key: string, opts: { allowOwnerKey?: boolean } = {}) {
  const trimmed = key.trim();
  if (trimmed.length < 10) throw new LinkKeyError("That doesn't look like a SalesBlink API key.");
  const hash = sha256(trimmed);

  const other = await db.workspace.findFirst({ where: { salesblinkKeyHash: hash, id: { not: workspaceId } }, select: { name: true } });
  if (other) throw new LinkKeyError(`This key is already linked to the MithMill workspace "${other.name}". Create a separate key inside this workspace's SalesBlink workspace.`);

  const owner = await platformOwnerKey();
  if (!opts.allowOwnerKey && owner && owner === trimmed) {
    throw new LinkKeyError("That's your main SalesBlink key. Create a new key inside this workspace's SalesBlink workspace, or choose \"Use my main SalesBlink workspace\".");
  }

  try {
    await new SalesBlinkClient(trimmed).verify();
  } catch (e) {
    const msg = e instanceof SalesBlinkError ? e.message : (e as Error).message;
    throw new LinkKeyError(`SalesBlink rejected the key: ${msg}`);
  }

  await db.workspace.update({
    where: { id: workspaceId },
    data: { salesblinkApiKeyEnc: encrypt(trimmed), salesblinkKeyHash: hash, sendingEngine: "SALESBLINK", salesblinkSyncState: {} },
  });
  await getQueue(QUEUES.salesblink).add("sync-senders", { kind: "sync-senders", workspaceId }, { attempts: 2 });
}

/** Links a workspace to the SalesBlink account's main workspace (the platform owner key). */
export async function linkMainSalesblinkWorkspace(workspaceId: string) {
  const owner = await platformOwnerKey();
  if (!owner) throw new LinkKeyError("No platform SalesBlink key is configured.");
  await linkWorkspaceKey(workspaceId, owner, { allowOwnerKey: true });
  await db.workspace.update({ where: { id: workspaceId }, data: { salesblinkWorkspaceId: null, salesblinkWorkspaceName: "Main SalesBlink workspace" } });
}

export async function unlinkWorkspace(workspaceId: string) {
  await db.workspace.update({
    where: { id: workspaceId },
    data: { salesblinkApiKeyEnc: null, salesblinkKeyHash: null, sendingEngine: "BUILTIN" },
  });
}

export type SalesblinkLinkState = "no-platform-key" | "not-created" | "awaiting-key" | "linked";

export async function linkState(ws: Pick<Workspace, "salesblinkApiKeyEnc" | "salesblinkWorkspaceId">): Promise<SalesblinkLinkState> {
  if (ws.salesblinkApiKeyEnc) return "linked";
  if (ws.salesblinkWorkspaceId) return "awaiting-key";
  return (await platformOwnerKey()) ? "not-created" : "no-platform-key";
}

/**
 * For a workspace that was linked to the main SalesBlink workspace: creates its own SalesBlink
 * workspace, drops the main key and removes the inboxes that were mirrored from the main
 * workspace (they stay in SalesBlink). The workspace is then waiting for its own key (step 2).
 */
export async function moveToOwnSalesblinkWorkspace(workspaceId: string) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (ws.salesblinkWorkspaceId) throw new LinkKeyError("This workspace already has its own SalesBlink workspace.");
  const client = await platformClient();
  if (!client) throw new LinkKeyError("No platform SalesBlink key is configured.");
  const name = salesblinkWorkspaceName(ws.name);
  const res = await client.request<{ data: { id: string; name: string } }>("POST", "/workspaces", { json: { name } });
  const [removed] = await db.$transaction([
    db.emailAccount.deleteMany({ where: { workspaceId, salesblinkSenderId: { not: null } } }),
    db.workspace.update({
      where: { id: workspaceId },
      data: {
        salesblinkWorkspaceId: res.data.id,
        salesblinkWorkspaceName: res.data.name ?? name,
        salesblinkApiKeyEnc: null,
        salesblinkKeyHash: null,
        salesblinkSyncState: {},
        sendingEngine: "SALESBLINK",
      },
    }),
  ]);
  return { name: res.data.name ?? name, removedInboxes: removed.count };
}
