import type { Workspace } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { salesblinkOAuthApps } from "@/server/salesblink/oauth-apps";

/** Google Admin → Security → API controls → App access control ("Configure new app" lives here). */
const GOOGLE_ADMIN_APPS_URL = "https://admin.google.com/ac/owl/list?tab=configuredApps";

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
        <div className="grid content-start gap-3">
          <p className="text-sm font-medium">Google Workspace</p>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
            <li>
              <a href={GOOGLE_ADMIN_APPS_URL} target="_blank" rel="noopener" className={buttonVariants({ size: "sm" })}>
                Open Google Admin → App access ↗
              </a>
              <span className="mt-1 block">Sign in as a Google Workspace super admin.</span>
            </li>
            <li>
              Click <b>Configure new app</b>, then paste this Client ID into the search box and press Enter:
              <div className="mt-1.5">
                <ClientId id={apps.google} />
              </div>
            </li>
            <li>Select the app, choose who it applies to (whole organisation or a group), click <b>Continue</b>.</li>
            <li>
              Choose <b>Trusted</b> → <b>Continue</b> → <b>Finish</b>. Then click <b>Connect Google</b> again (it can take a few minutes to apply).
            </li>
          </ol>
        </div>
        <div className="grid content-start gap-3">
          <p className="text-sm font-medium">Microsoft 365</p>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
            <li>
              {msConsent ? (
                <a href={msConsent} target="_blank" rel="noopener" className={buttonVariants({ size: "sm" })}>
                  Approve for my organisation ↗
                </a>
              ) : (
                <span>Approval link unavailable right now — reload in a minute.</span>
              )}
              <span className="mt-1 block">Sign in as a Microsoft 365 global admin and click <b>Accept</b>. Or send your admin this link:</span>
            </li>
            <li>
              Client ID (if your admin asks for it):
              <div className="mt-1.5">
                <ClientId id={apps.microsoft} />
              </div>
            </li>
          </ol>
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
