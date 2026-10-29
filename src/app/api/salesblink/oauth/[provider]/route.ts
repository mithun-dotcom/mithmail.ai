import { NextResponse } from "next/server";
import { requireWorkspace } from "@/server/workspace";
import { clientFor } from "@/server/salesblink/service";
import { getQueue, QUEUES } from "@/server/queue";

/**
 * Starts Google / Outlook OAuth for this workspace's SalesBlink workspace. The inbox is connected
 * inside that SalesBlink workspace; MithMill picks it up with the follow-up syncs queued here.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { workspace } = await requireWorkspace("ADMIN");
  const provider = (await params).provider;
  if (provider !== "google" && provider !== "outlook") return new NextResponse("Unknown provider", { status: 404 });
  try {
    const res = await clientFor(workspace).request<{ data: { auth_url: string } }>("POST", `/oauth/${provider}`, { json: {} });
    await queueFollowUpSyncs(workspace.id);
    return NextResponse.redirect(res.data.auth_url);
  } catch (e) {
    return new NextResponse(`SalesBlink: ${(e as Error).message}`, { status: 502 });
  }
}

/** Follow-up syncs are a convenience (the popup also polls), so sign-in never waits on Redis. */
async function queueFollowUpSyncs(workspaceId: string) {
  const q = getQueue(QUEUES.salesblink);
  const add = async () => {
    for (const minutes of [1, 3, 10]) {
      await q.add("sync-senders", { kind: "sync-senders", workspaceId }, {
        delay: minutes * 60_000,
        jobId: `sb-oauth-sync-${workspaceId}-${minutes}-${Math.floor(Date.now() / 60_000)}`,
      });
    }
  };
  // BullMQ waits for Redis indefinitely while it is down; give up after 3 s.
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis timeout")), 3_000));
  await Promise.race([add(), timeout]).catch((e) =>
    console.warn(JSON.stringify({ msg: "could not queue follow-up sender syncs", err: (e as Error).message })),
  );
}
