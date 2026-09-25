"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { PLANS } from "@/lib/plans";
import { requireUser, WORKSPACE_COOKIE } from "@/server/workspace";

async function setWorkspaceCookie(id: string) {
  (await cookies()).set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function createWorkspace(formData: FormData) {
  const user = await requireUser();
  const name = z.string().trim().min(2).max(60).parse(formData.get("name"));

  let slug = slugify(name) || "workspace";
  if (await db.workspace.findUnique({ where: { slug } })) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;

  const ws = await db.workspace.create({
    data: {
      name,
      slug,
      subscriptionTier: "FREE",
      maxInboxes: PLANS.FREE.maxInboxes,
      monthlyEmailQuota: PLANS.FREE.monthlyEmailQuota,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  await setWorkspaceCookie(ws.id);
  redirect("/dashboard");
}

export async function selectWorkspace(formData: FormData) {
  const user = await requireUser();
  const id = z.string().uuid().parse(formData.get("workspaceId"));
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: id, userId: user.id } },
  });
  if (!member) throw new Error("Not a member of this workspace");
  await setWorkspaceCookie(id);
  redirect("/dashboard");
}
