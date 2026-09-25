"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";

export async function setWarmupForAll(enabled: boolean) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.emailAccount.updateMany({ where: { workspaceId: workspace.id }, data: { isWarmupEnabled: enabled } });
  if (enabled) {
    await db.emailAccount.updateMany({ where: { workspaceId: workspace.id, warmupStartedAt: null }, data: { warmupStartedAt: new Date() } });
  }
  revalidatePath("/warmup");
  revalidatePath("/accounts");
}

export async function toggleWarmup(id: string, enabled: boolean) {
  const { workspace } = await requireWorkspace("ADMIN");
  const acc = await db.emailAccount.findFirstOrThrow({ where: { id, workspaceId: workspace.id } });
  await db.emailAccount.update({
    where: { id },
    data: { isWarmupEnabled: enabled, ...(enabled && !acc.warmupStartedAt ? { warmupStartedAt: new Date() } : {}) },
  });
  revalidatePath("/warmup");
}
