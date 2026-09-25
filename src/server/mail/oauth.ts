import type { EmailAccount } from "@prisma/client";
import { decrypt } from "@/lib/crypto";

interface CachedToken {
  token: string;
  expiresAt: number;
}
const cache = new Map<string, CachedToken>();

export const OAUTH = {
  GOOGLE: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile https://mail.google.com/",
  },
  MICROSOFT: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:
      "openid email profile offline_access https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All",
  },
} as const;

export function clientCredentials(provider: "GOOGLE" | "MICROSOFT") {
  return provider === "GOOGLE"
    ? { id: process.env.AUTH_GOOGLE_ID, secret: process.env.AUTH_GOOGLE_SECRET }
    : { id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID, secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET };
}

/** Exchanges the stored refresh token for a short-lived access token (cached until ~1 min before expiry). */
export async function getAccessToken(account: EmailAccount): Promise<string> {
  if (account.provider === "SMTP" || !account.oauthRefreshTokenEnc) {
    throw new Error("Account is not OAuth-connected");
  }
  const hit = cache.get(account.id);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const { id, secret } = clientCredentials(account.provider);
  if (!id || !secret) throw new Error(`OAuth client for ${account.provider} is not configured`);

  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
    refresh_token: decrypt(account.oauthRefreshTokenEnc),
  });
  if (account.provider === "MICROSOFT") body.set("scope", OAUTH.MICROSOFT.scope);
  const res = await fetch(OAUTH[account.provider].token, { method: "POST", body });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`OAuth refresh failed: ${json.error_description ?? res.statusText}`);
  }
  cache.set(account.id, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}
