"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyCname } from "@/lib/dns";
import { requireWorkspace } from "@/server/workspace";
import { refreshDomainHealth } from "@/server/services/domain-health";
import { domainOf } from "@/lib/utils";
import { startPlacementTest } from "@/server/deliverability/placement";

export async function addTrackingDomain(formData: FormData) {
  const { workspace } = await requireWorkspace("ADMIN");
  const domainName = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a hostname like track.yourdomain.com")
    .parse(formData.get("domainName"));
  await db.trackingDomain.upsert({
    where: { domainName },
    create: { workspaceId: workspace.id, domainName },
    update: {},
  });
  revalidatePath("/deliverability");
}

export async function verifyTrackingDomain(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  const td = await db.trackingDomain.findFirstOrThrow({ where: { id, workspaceId: workspace.id } });
  const ok = await verifyCname(td.domainName, process.env.TRACKING_CNAME_TARGET ?? "track.mithmill.app");
  await db.trackingDomain.update({ where: { id }, data: { cnameVerified: ok, lastCheckedAt: new Date() } });
  revalidatePath("/deliverability");
}

export async function deleteTrackingDomain(id: string) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.trackingDomain.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/deliverability");
}

/** Re-checks every distinct sending domain in this workspace. */
export async function recheckAllDomains() {
  const { workspace } = await requireWorkspace("ADMIN");
  const accounts = await db.emailAccount.findMany({ where: { workspaceId: workspace.id }, select: { id: true, emailAddress: true } });
  const seen = new Set<string>();
  for (const a of accounts) {
    const d = domainOf(a.emailAddress);
    if (seen.has(d)) continue;
    seen.add(d);
    await refreshDomainHealth(a.id);
  }
  // Fan the fresh results out to the other inboxes on each domain.
  const fresh = await db.domainHealth.findMany({ where: { emailAccount: { workspaceId: workspace.id } }, orderBy: { lastCheckedAt: "desc" } });
  const latest = new Map<string, (typeof fresh)[number]>();
  for (const h of fresh) if (!latest.has(h.domain)) latest.set(h.domain, h);
  for (const a of accounts) {
    const h = latest.get(domainOf(a.emailAddress));
    if (!h) continue;
    const { id: _i, emailAccountId: _e, ...copy } = h;
    await db.domainHealth.upsert({ where: { emailAccountId: a.id }, create: { ...copy, emailAccountId: a.id }, update: copy });
  }
  revalidatePath("/deliverability");
  revalidatePath("/accounts");
}

export async function runPlacementTest(formData: FormData) {
  const { workspace } = await requireWorkspace("ADMIN");
  const accountId = z.string().uuid().parse(formData.get("emailAccountId"));
  await startPlacementTest(workspace.id, accountId);
  revalidatePath("/deliverability");
}
