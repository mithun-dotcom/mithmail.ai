import { recordEvent, clientMeta } from "@/server/services/tracking-events";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.gif$/, "");
  await recordEvent(id, "OPEN", clientMeta(req)).catch(() => undefined);
  return new Response(PIXEL, {
    headers: { "content-type": "image/gif", "cache-control": "no-store, no-cache, must-revalidate, private", "content-length": String(PIXEL.length) },
  });
}
