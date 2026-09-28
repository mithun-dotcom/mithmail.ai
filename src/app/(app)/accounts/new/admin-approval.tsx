import type { Workspace } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { salesblinkOAuthApps } from "@/server/salesblink/oauth-apps";

function ClientId({ id }: { id: string | null }) {
  if (!id) return <p className="text-sm text-muted-foreground">Couldn&apos;t read the Client ID from SalesBlink right now. Reload in a minute.</p>;
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">{id}</code>
      <CopyButton value={id} />
    </div>
  );
}

/** Steps for Google Workspace / Microsoft 365 admins to allow the (SalesBlink) OAuth app. */
export async function AdminApprovalCard({ workspace }: { workspace: Workspace }) {
  const apps = await salesblinkOAuthApps(workspace);
  const msConsent = apps.microsoft ? `https://login.microsoftonline.com/common/adminconsent?client_id=${encodeURIComponent(apps.microsoft)}` : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>&ldquo;This app is blocked&rdquo; / &ldquo;Google blocked this access&rdquo;?</CardTitle>
        <CardDescription>
          Organisations that restrict third-party apps must allow the sign-in app once. Google and Microsoft inboxes connect through SalesBlink&apos;s app,
          so its name appears on the sign-in screen. Send your admin the Client ID below.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Google Workspace</p>
          <ClientId id={apps.google} />
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Open <b>admin.google.com</b> → <b>Security</b> → <b>Access and data control</b> → <b>API controls</b>.
            </li>
            <li>
              <b>Manage Third-Party App Access</b> → <b>Add app</b> → <b>OAuth App Name Or Client ID</b>.
            </li>
            <li>Paste the Client ID above, select the app, choose who it applies to.</li>
            <li>
              Set access to <b>Trusted</b> and click <b>Finish</b>. Then try <b>Connect Google</b> again (it can take a few minutes to apply).
            </li>
          </ol>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Microsoft 365</p>
          <ClientId id={apps.microsoft} />
          <p className="text-sm text-muted-foreground">
            A Microsoft 365 admin opens this link, signs in and clicks <b>Accept</b> to approve it for the whole organisation:
          </p>
          {msConsent && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">{msConsent}</code>
              <CopyButton value={msConsent} />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground md:col-span-2">
          Prefer no third-party app at all? Use <b>SMTP / IMAP</b> below with the <b>Google (app password)</b> or <b>Microsoft (app password)</b> preset.
        </p>
      </CardContent>
    </Card>
  );
}
