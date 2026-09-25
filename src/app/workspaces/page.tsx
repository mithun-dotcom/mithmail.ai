import { Building2, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/server/workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/logo";
import { createWorkspace, selectWorkspace } from "./actions";

export default async function WorkspacesPage() {
  const user = await requireUser();
  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: { include: { _count: { select: { emailAccounts: true, campaigns: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-royal-50 to-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Logo />
        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-royal-950">Choose a workspace</h1>
        <p className="mt-2 text-muted-foreground">
          Workspaces keep inboxes, campaigns and leads separate — one per brand or client.
        </p>

        <div className="mt-8 grid gap-3">
          {memberships.map(({ workspace, role }) => (
            <form key={workspace.id} action={selectWorkspace}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <button className="flex w-full items-center gap-4 rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-royal-300 hover:shadow">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-gradient text-white">
                  <Building2 className="h-5 w-5" />
                </span>
                <span className="flex-1">
                  <span className="block font-medium">{workspace.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {workspace._count.emailAccounts} inboxes · {workspace._count.campaigns} campaigns
                  </span>
                </span>
                <Badge variant={role === "OWNER" ? "warning" : "default"}>{role.toLowerCase()}</Badge>
              </button>
            </form>
          ))}
        </div>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Create a new workspace</CardTitle>
            <CardDescription>You will be the owner and can invite teammates later.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createWorkspace} className="flex gap-2">
              <Input name="name" placeholder="Acme Outbound" required minLength={2} maxLength={60} />
              <Button type="submit">
                <Plus /> Create
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
