import { formatDistanceToNow } from "date-fns";
import { db } from "@/lib/db";
import { requireWorkspace, canEdit } from "@/server/workspace";
import { WEBHOOK_EVENTS } from "@/server/services/webhooks";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { deleteWebhook, removeFromBlocklist, removeMember, renameWorkspace, revokeApiKey, toggleWebhook } from "./actions";
import { ApiKeyForm, BlocklistForm, InviteForm, WebhookForm } from "./forms";

export default async function SettingsPage() {
  const { workspace, role } = await requireWorkspace();
  const [members, blocklist, blockCount, apiKeys, webhooks, inboxCount] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId: workspace.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.globalBlocklist.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.globalBlocklist.count({ where: { workspaceId: workspace.id } }),
    db.apiKey.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" } }),
    db.webhook.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" } }),
    db.emailAccount.count({ where: { workspaceId: workspace.id } }),
  ]);
  const editable = canEdit(role);

  return (
    <>
      <PageHeader title="Settings" description={`Your role: ${role.toLowerCase()}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>
              Plan: <b>{workspace.subscriptionTier.toLowerCase()}</b> · {inboxCount}/{workspace.maxInboxes} inboxes · {workspace.monthlyEmailQuota.toLocaleString()} emails/month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={renameWorkspace} className="flex gap-2">
              <Input name="name" defaultValue={workspace.name} disabled={!editable} />
              <Button variant="outline" disabled={!editable}>Rename</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>Admins manage inboxes and campaigns; viewers can read everything.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{m.user.name ?? m.user.email} <span className="text-muted-foreground">{m.user.name && `· ${m.user.email}`}</span></span>
                <Badge variant={m.role === "OWNER" ? "warning" : "default"}>{m.role.toLowerCase()}</Badge>
                {editable && m.role !== "OWNER" && (
                  <form action={removeMember.bind(null, m.id)}><Button size="sm" variant="ghost">Remove</Button></form>
                )}
              </div>
            ))}
            {editable && <InviteForm />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global blocklist</CardTitle>
            <CardDescription>{blockCount} {blockCount === 1 ? "entry" : "entries"}. Blocked emails and domains are never contacted by any campaign; unsubscribes are added automatically.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {editable && <BlocklistForm />}
            <div className="flex flex-wrap gap-1.5">
              {blocklist.map((b) => (
                <form key={b.id} action={removeFromBlocklist.bind(null, b.id)}>
                  <button className="rounded-full bg-muted px-2.5 py-0.5 text-xs hover:bg-red-100" title="Remove" disabled={!editable}>
                    {b.emailOrDomain} ×
                  </button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>
              Use with the REST API: <code className="rounded bg-muted px-1 text-xs">Authorization: Bearer mm_live_…</code> — see <code className="text-xs">/api/v1</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {apiKeys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1">{k.name} <code className="text-xs text-muted-foreground">{k.prefix}…</code></span>
                <span className="text-xs text-muted-foreground">{k.lastUsedAt ? `used ${formatDistanceToNow(k.lastUsedAt)} ago` : "never used"}</span>
                {editable && <form action={revokeApiKey.bind(null, k.id)}><Button size="sm" variant="ghost">Revoke</Button></form>}
              </div>
            ))}
            {editable && <ApiKeyForm />}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Webhooks</CardTitle>
            <CardDescription>POST JSON to your endpoint on events. Signed with HMAC-SHA256 over <code className="text-xs">timestamp.body</code>.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {webhooks.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <code className="min-w-0 flex-1 truncate text-xs">{w.url}</code>
                <span className="text-xs text-muted-foreground">{w.events.join(", ")}</span>
                {w.lastStatus !== null && <Badge variant={w.lastStatus >= 200 && w.lastStatus < 300 ? "success" : "danger"}>{w.lastStatus || "error"}</Badge>}
                {editable && (
                  <>
                    <form action={toggleWebhook.bind(null, w.id, !w.isActive)}><Button size="sm" variant="outline">{w.isActive ? "Pause" : "Resume"}</Button></form>
                    <form action={deleteWebhook.bind(null, w.id)}><Button size="sm" variant="ghost">Delete</Button></form>
                  </>
                )}
              </div>
            ))}
            {editable && <WebhookForm events={WEBHOOK_EVENTS} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
