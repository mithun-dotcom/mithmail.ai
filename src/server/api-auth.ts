import { NextResponse } from "next/server";
import type { Workspace } from "@prisma/client";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { redis } from "@/server/queue";

const LIMIT_PER_MIN = 120;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Resolves the workspace for a `Authorization: Bearer mm_live_…` request and applies a per-key rate limit. */
export async function authenticate(req: Request): Promise<Workspace> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("mm_")) throw new ApiError(401, "Missing or malformed API key");
  const record = await db.apiKey.findUnique({ where: { keyHash: sha256(key) }, include: { workspace: true } });
  if (!record) throw new ApiError(401, "Invalid API key");

  try {
    const r = await redis();
    const bucket = `mm:rl:${record.id}:${Math.floor(Date.now() / 60_000)}`;
    const n = await r.incr(bucket);
    if (n === 1) await r.expire(bucket, 70);
    if (n > LIMIT_PER_MIN) throw new ApiError(429, `Rate limit exceeded (${LIMIT_PER_MIN}/min)`);
  } catch (e) {
    if (e instanceof ApiError) throw e; // Redis down: fail open rather than break integrations
  }
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  }
  return record.workspace;
}

export function apiHandler<C>(fn: (req: Request, workspace: Workspace, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const ws = await authenticate(req);
      const data = await fn(req, ws, ctx);
      return NextResponse.json({ data });
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "Validation failed", details: (e as { issues: unknown }).issues }, { status: 422 });
      console.error("API error", e);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}
