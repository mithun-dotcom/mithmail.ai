import { verify } from "@/lib/tracking";
import { recordEvent, clientMeta } from "@/server/services/tracking-events";

export const dynamic = "force-dynamic";

const page = (msg: string) =>
  new Response(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Unsubscribe</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 16px;color:#141c52"><p>${msg}</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

async function handle(req: Request, id: string, confirmed: boolean) {
  const sig = new URL(req.url).searchParams.get("s") ?? "";
  if (!verify(`unsub|${id}`, sig)) return page("This link is invalid or has expired.");
  if (!confirmed) {
    // GET shows a confirm button so link scanners can't unsubscribe people by prefetching.
    return new Response(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Unsubscribe</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 16px;color:#141c52">
<p>Stop receiving these emails?</p><form method="post"><button style="padding:8px 16px">Unsubscribe</button></form></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  await recordEvent(id, "UNSUBSCRIBE", clientMeta(req));
  return page("You've been unsubscribed. You won't hear from us again.");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, (await params).id, false);
}

// RFC 8058 one-click unsubscribe (List-Unsubscribe-Post) and the confirm form both POST here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, (await params).id, true);
}
