import { NextResponse } from "next/server";
import { requireWorkspace } from "@/server/workspace";
import { clientFor } from "@/server/salesblink/service";

/** Sends the user to SalesBlink's own connection page (Google / Outlook OAuth, SMTP) via a magic login link. */
export async function GET() {
  const { workspace } = await requireWorkspace("ADMIN");
  try {
    const link = await clientFor(workspace).connectLink();
    return NextResponse.redirect(link);
  } catch (e) {
    return new NextResponse(`Could not get a SalesBlink connection link: ${(e as Error).message}`, { status: 502 });
  }
}
