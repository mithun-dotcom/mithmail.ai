import { NextResponse, type NextRequest } from "next/server";
import { randomToken } from "@/lib/crypto";
import { OAUTH, clientCredentials } from "@/server/mail/oauth";
import { requireWorkspace } from "@/server/workspace";

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  await requireWorkspace("ADMIN");
  const provider = (await params).provider.toUpperCase();
  if (provider !== "GOOGLE" && provider !== "MICROSOFT") return new NextResponse("Unknown provider", { status: 404 });

  const { id } = clientCredentials(provider);
  if (!id) return new NextResponse(`${provider} OAuth is not configured`, { status: 400 });

  const state = randomToken(16);
  const redirectUri = new URL(`/api/oauth/${provider.toLowerCase()}/callback`, process.env.APP_URL ?? req.nextUrl.origin).toString();
  const url = new URL(OAUTH[provider].authorize);
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH[provider].scope);
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", provider === "GOOGLE" ? "consent" : "select_account");
  if (provider === "GOOGLE") url.searchParams.set("access_type", "offline");

  const res = NextResponse.redirect(url);
  res.cookies.set("mm_oauth_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
