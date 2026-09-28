/**
 * One SalesBlink workspace per MithMill workspace: creation, key linking guards, renames,
 * and per-workspace calls (OAuth start, bulk senders) using that workspace's own key.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { redis } from "@/server/queue";
import { clientFor } from "@/server/salesblink/service";
import {
  createSalesblinkWorkspace,
  linkState,
  linkWorkspaceKey,
  linkMainSalesblinkWorkspace,
  moveToOwnSalesblinkWorkspace,
  renameSalesblinkWorkspace,
  salesblinkWorkspaceName,
} from "@/server/salesblink/provisioning";
import { startSalesblinkMock } from "./salesblink-mock";

const OWNER = `owner_${randomUUID()}`;
const KEY_A = `key_a_${randomUUID()}`;
const KEY_B = `key_b_${randomUUID()}`;
const run = randomUUID().slice(0, 6);
let mock: Awaited<ReturnType<typeof startSalesblinkMock>>;
const ids: string[] = [];
const prevEnv = process.env.SALESBLINK_API_KEY;

beforeAll(async () => {
  mock = await startSalesblinkMock([OWNER, KEY_A, KEY_B]);
  process.env.SALESBLINK_API_URL = mock.url;
  process.env.SALESBLINK_API_KEY = OWNER;
});

afterAll(async () => {
  await db.workspace.deleteMany({ where: { id: { in: ids } } });
  process.env.SALESBLINK_API_KEY = prevEnv;
  await mock.close();
  (await redis()).disconnect();
  await db.$disconnect();
});

async function newWorkspace(name: string) {
  const ws = await db.workspace.create({ data: { name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${run}` } });
  ids.push(ws.id);
  return ws;
}

describe("SalesBlink workspace provisioning", () => {
  it("pads short names to SalesBlink's 4-character minimum", () => {
    expect(salesblinkWorkspaceName("Ab")).toBe("Ab workspace");
    expect(salesblinkWorkspaceName("Acme Outbound")).toBe("Acme Outbound");
  });

  it("creates a same-named SalesBlink workspace, once", async () => {
    const ws = await newWorkspace(`Client A ${run}`);
    expect(await linkState(ws)).toBe("not-created");
    const created = await createSalesblinkWorkspace(ws.id);
    expect(created?.name).toBe(`Client A ${run}`);
    await createSalesblinkWorkspace(ws.id); // idempotent
    expect(mock.state.workspaces.filter((w) => w.name === `Client A ${run}`)).toHaveLength(1);
    const saved = await db.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    expect(saved).toMatchObject({ salesblinkWorkspaceId: created!.id, sendingEngine: "SALESBLINK" });
    expect(await linkState(saved)).toBe("awaiting-key");
    // Creation calls use the owner key.
    expect(mock.calls.find((c) => c.method === "POST" && c.path === "/workspaces")!.auth).toBe(OWNER);
  });

  it("links a workspace key and refuses the owner key or a key used elsewhere", async () => {
    const a = await db.workspace.findFirstOrThrow({ where: { name: `Client A ${run}` } });
    const b = await newWorkspace(`Client B ${run}`);
    await createSalesblinkWorkspace(b.id);

    await expect(linkWorkspaceKey(a.id, OWNER)).rejects.toThrow(/main SalesBlink key/);
    await expect(linkWorkspaceKey(a.id, "not-a-real-key-123")).rejects.toThrow(/rejected/);
    await linkWorkspaceKey(a.id, KEY_A);
    await expect(linkWorkspaceKey(b.id, KEY_A)).rejects.toThrow(/already linked to the MithMill workspace/);
    await linkWorkspaceKey(b.id, KEY_B);

    const [sa, sb] = await Promise.all([db.workspace.findUniqueOrThrow({ where: { id: a.id } }), db.workspace.findUniqueOrThrow({ where: { id: b.id } })]);
    expect(sa.salesblinkKeyHash).toBe(sha256(KEY_A));
    expect(sb.salesblinkKeyHash).toBe(sha256(KEY_B));
    expect(await linkState(sa)).toBe("linked");
  });

  it("routes each workspace's calls through its own key", async () => {
    const a = await db.workspace.findFirstOrThrow({ where: { name: `Client A ${run}` } });
    const b = await db.workspace.findFirstOrThrow({ where: { name: `Client B ${run}` } });
    const before = mock.calls.length;
    await clientFor(a).request("POST", "/oauth/google", { json: {} });
    await clientFor(b).addBulkSenders("from_email,password,smtp_host,smtp_port\nx@y.io,p,smtp.y.io,587");
    const calls = mock.calls.slice(before);
    expect(calls.map((c) => [c.path, c.auth])).toEqual([
      ["/oauth/google", KEY_A],
      ["/senders/add-bulk-senders", KEY_B],
    ]);
    expect(mock.state.bulkUploads.at(-1)).toContain("x@y.io,p,smtp.y.io,587");
  });

  it("never falls back to the platform key for an unlinked workspace", async () => {
    const c = await newWorkspace(`Client C ${run}`);
    expect(() => clientFor(c)).toThrow(/isn't linked/);
  });

  it("renames the SalesBlink workspace with the MithMill one", async () => {
    const a = await db.workspace.update({ where: { id: (await db.workspace.findFirstOrThrow({ where: { name: `Client A ${run}` } })).id }, data: { name: `Client A2 ${run}` } });
    await renameSalesblinkWorkspace(a);
    expect(mock.state.workspaces.find((w) => w.id === a.salesblinkWorkspaceId)!.name).toBe(`Client A2 ${run}`);
  });

  it("can link one workspace to the main SalesBlink workspace", async () => {
    const d = await newWorkspace(`Client D ${run}`);
    await linkMainSalesblinkWorkspace(d.id);
    const saved = await db.workspace.findUniqueOrThrow({ where: { id: d.id } });
    expect(saved.salesblinkKeyHash).toBe(sha256(OWNER));
    // …but only one.
    const e = await newWorkspace(`Client E ${run}`);
    await expect(linkMainSalesblinkWorkspace(e.id)).rejects.toThrow(/already linked/);
  });

  it("moves a workspace off the main SalesBlink workspace onto its own", async () => {
    const d = await db.workspace.findFirstOrThrow({ where: { salesblinkKeyHash: sha256(OWNER), id: { in: ids } } });
    await db.emailAccount.create({ data: { workspaceId: d.id, emailAddress: `main-${run}@x.io`, provider: "SMTP", salesblinkSenderId: "snd_main" } });
    const r = await moveToOwnSalesblinkWorkspace(d.id);
    expect(r).toEqual({ name: `Client D ${run}`, removedInboxes: 1 });
    const saved = await db.workspace.findUniqueOrThrow({ where: { id: d.id } });
    expect(saved.salesblinkApiKeyEnc).toBeNull();
    expect(saved.salesblinkKeyHash).toBeNull();
    expect(mock.state.workspaces.some((w) => w.id === saved.salesblinkWorkspaceId && w.name === `Client D ${run}`)).toBe(true);
    expect(await linkState(saved)).toBe("awaiting-key");
    expect(await db.emailAccount.count({ where: { workspaceId: d.id } })).toBe(0);
    await expect(moveToOwnSalesblinkWorkspace(d.id)).rejects.toThrow(/already has its own/);
  });
});
