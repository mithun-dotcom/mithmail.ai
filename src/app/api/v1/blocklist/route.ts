import { z } from "zod";
import { db } from "@/lib/db";
import { apiHandler } from "@/server/api-auth";

export const POST = apiHandler(async (req, ws) => {
  const { entries } = z.object({ entries: z.array(z.string().trim().toLowerCase().min(3)).min(1).max(5000) }).parse(await req.json());
  const res = await db.globalBlocklist.createMany({ data: entries.map((e) => ({ workspaceId: ws.id, emailOrDomain: e.replace(/^@/, "") })), skipDuplicates: true });
  return { added: res.count };
});
