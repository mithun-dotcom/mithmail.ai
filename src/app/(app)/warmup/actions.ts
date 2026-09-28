"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/server/workspace";
import { pushSenderSettings } from "@/server/salesblink/service";
import { getQueue, QUEUES } from "@/server/queue";

export async function setWarmupForAll(enabled: boolean) {
  const { workspace } = await requireWorkspace("ADMIN");
  await db.emailAccount.updateMany({ where: { workspaceId: workspace.id }, data: { isWarmupEnabled: enabled } });
  if (enabled) {
    await db.emailAccount.updateMany({ where: { workspaceId: workspace.id, warmupStartedAt: null }, data: { warmupStartedAt: new Date() } });
  }
  if (await db.emailAccount.count({ where: { workspaceId: workspace.id, salesblinkSenderId: { not: null } } })) {
    await getQueue(QUEUES.salesblink).add("push-senders", { kind: "push-senders", workspaceId: workspace.id }, { attempts: 2 });
  }
  revalidatePath("/warmup");
  revalidatePath("/accounts");
}

export async function toggleWarmup(id: string, enabled: boolean) {
  const { workspace } = await requireWorkspace("ADMIN");
  const acc = await db.emailAccount.findFirstOrThrow({ where: { id, workspaceId: workspace.id } });
  const updated = await db.emailAccount.update({
    where: { id },
    data: { isWarmupEnabled: enabled, ...(enabled && !acc.warmupStartedAt ? { warmupStartedAt: new Date() } : {}) },
  });
  if (updated.salesblinkSenderId) await pushSenderSettings(updated);
  revalidatePath("/warmup");
}
