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
    const q = getQueue(QUEUES.salesblink);
    for (const minutes of [1, 3, 10]) {
      await q.add("sync-senders", { kind: "sync-senders", workspaceId: workspace.id }, {
        delay: minutes * 60_000,
        jobId: `sb-oauth-sync-${workspace.id}-${minutes}-${Math.floor(Date.now() / 60_000)}`,
      });
    }
    return NextResponse.redirect(res.data.auth_url);
  } catch (e) {
    return new NextResponse(`SalesBlink: ${(e as Error).message}`, { status: 502 });
  }
}
