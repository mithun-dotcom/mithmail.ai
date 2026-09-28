/**
 * Google / Microsoft inboxes connect through SalesBlink's own OAuth apps (their API only
 * accepts senders connected that way). Organisations that restrict third-party apps must
 * allow that app's Client ID, so we read it from the auth URL SalesBlink hands out.
 */
import type { Workspace } from "@prisma/client";
import { sha256 } from "@/lib/crypto";
import { redis } from "@/server/queue";
import { clientFor, salesblinkKey } from "./service";

export interface OAuthApps {
  google: string | null;
  microsoft: string | null;
}

export function clientIdFromAuthUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("client_id");
  } catch {
    return null;
  }
}

/** Client IDs of SalesBlink's Google and Microsoft apps (cached a day per key). */
export async function salesblinkOAuthApps(ws: Workspace): Promise<OAuthApps> {
  const key = salesblinkKey(ws);
  if (!key) return { google: null, microsoft: null };
  const cacheKey = `mm:sb:oauth-apps:${sha256(key).slice(0, 16)}`;
  try {
    const r = await redis();
    const hit = await r.get(cacheKey);
    if (hit) return JSON.parse(hit) as OAuthApps;
  } catch {
    /* no cache */
  }
  const client = clientFor(ws);
  const get = async (provider: "google" | "outlook") => {
    try {
      const res = await client.request<{ data: { auth_url: string } }>("POST", `/oauth/${provider}`, { json: {} });
      return clientIdFromAuthUrl(res.data?.auth_url);
    } catch {
      return null;
    }
  };
  const apps: OAuthApps = { google: await get("google"), microsoft: await get("outlook") };
  if (apps.google || apps.microsoft) {
    try {
      await (await redis()).set(cacheKey, JSON.stringify(apps), "EX", 86_400);
    } catch {
      /* ignore */
    }
  }
  return apps;
}
