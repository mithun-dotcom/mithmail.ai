import { NextResponse } from "next/server";
import { verify } from "@/lib/tracking";
import { recordEvent, clientMeta } from "@/server/services/tracking-events";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const target = url.searchParams.get("u") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  // Signed links only — never an open redirect.
  if (!/^https?:\/\//i.test(target) || !verify(`${id}|${target}`, sig)) {
    return new NextResponse("Invalid link", { status: 400 });
  }
  await recordEvent(id, "CLICK", { ...clientMeta(req), url: target }).catch(() => undefined);
  return NextResponse.redirect(target, 302);
}
