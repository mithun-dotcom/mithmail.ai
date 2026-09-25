import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { WorkspaceRole } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export const WORKSPACE_COOKIE = "mm_ws";

const ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 0, ADMIN: 1, OWNER: 2 };

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

/** Resolves the active workspace for the signed-in user, or redirects to the picker. */
export async function requireWorkspace(minRole: WorkspaceRole = "VIEWER") {
  const user = await requireUser();
  const cookieStore = await cookies();
  const selected = cookieStore.get(WORKSPACE_COOKIE)?.value;

  const membership = selected
    ? await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: selected, userId: user.id } },
        include: { workspace: true },
      })
    : null;

  if (!membership) redirect("/workspaces");
  if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new Error("You do not have permission to perform this action.");
  }
  return { user, workspace: membership.workspace, role: membership.role };
}

export function canEdit(role: WorkspaceRole) {
  return ROLE_RANK[role] >= ROLE_RANK.ADMIN;
}
