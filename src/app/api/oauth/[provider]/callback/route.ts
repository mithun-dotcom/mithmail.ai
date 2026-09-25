import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { OAUTH, clientCredentials } from "@/server/mail/oauth";
import { PROVIDER_PRESETS } from "@/server/mail/presets";
import { requireWorkspace } from "@/server/workspace";
import { refreshDomainHealth } from "@/server/services/domain-health";

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { workspace } = await requireWorkspace("ADMIN");
  const provider = (await params).provider.toUpperCase();
  if (provider !== "GOOGLE" && provider !== "MICROSOFT") return new NextResponse("Unknown provider", { status: 404 });

  const fail = (msg: string) => NextResponse.redirect(new URL(`/accounts/new?error=${encodeURIComponent(msg)}`, req.nextUrl.origin));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("mm_oauth_state")?.value) return fail("OAuth state mismatch — please retry.");

  const { id, secret } = clientCredentials(provider);
  const body = new URLSearchParams({
    client_id: id ?? "",
    client_secret: secret ?? "",
    code,
    grant_type: "authorization_code",
    redirect_uri: new URL(`/api/oauth/${provider.toLowerCase()}/callback`, process.env.APP_URL ?? req.nextUrl.origin).toString(),
  });
  const tokenRes = await fetch(OAUTH[provider].token, { method: "POST", body });
  const tokens = (await tokenRes.json()) as { refresh_token?: string; id_token?: string; error_description?: string };
  if (!tokenRes.ok || !tokens.refresh_token || !tokens.id_token) {
    return fail(tokens.error_description ?? "Provider did not return a refresh token.");
  }

  const claims = decodeJwt(tokens.id_token);
  const email = String(claims.email ?? claims.preferred_username ?? "").toLowerCase();
  if (!email.includes("@")) return fail("Could not read the mailbox address.");

  const count = await db.emailAccount.count({ where: { workspaceId: workspace.id } });
  const existing = await db.emailAccount.findUnique({ where: { workspaceId_emailAddress: { workspaceId: workspace.id, emailAddress: email } } });
  if (!existing && count >= workspace.maxInboxes) return fail(`Your plan allows ${workspace.maxInboxes} inboxes.`);

  const preset = PROVIDER_PRESETS[provider];
  const account = await db.emailAccount.upsert({
    where: { workspaceId_emailAddress: { workspaceId: workspace.id, emailAddress: email } },
    create: {
      workspaceId: workspace.id,
      emailAddress: email,
      fromName: typeof claims.name === "string" ? claims.name : null,
      provider,
      ...preset,
      smtpUser: email,
      imapUser: email,
      oauthRefreshTokenEnc: encrypt(tokens.refresh_token),
      // Google Workspace / M365 inboxes tolerate a slightly higher default than generic SMTP.
      dailyLimit: 40,
    },
    update: { oauthRefreshTokenEnc: encrypt(tokens.refresh_token), status: "ACTIVE", lastError: null },
  });
  await refreshDomainHealth(account.id).catch(() => undefined);

  const res = NextResponse.redirect(new URL(`/accounts/${account.id}`, req.nextUrl.origin));
  res.cookies.delete("mm_oauth_state");
  return res;
}
