import { NextResponse } from "next/server";
import { requireWorkspace } from "@/server/workspace";
import { apiKeysLoginLink } from "@/server/salesblink/provisioning";

/** Magic login link to SalesBlink's API-keys page, so the owner can create this workspace's key. */
export async function GET() {
  await requireWorkspace("OWNER");
  try {
    return NextResponse.redirect(await apiKeysLoginLink());
  } catch (e) {
    return new NextResponse(`Could not get a SalesBlink login link: ${(e as Error).message}`, { status: 502 });
  }
}
