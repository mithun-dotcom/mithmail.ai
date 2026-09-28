import Link from "next/link";
import { Suspense } from "react";
import { AdminApprovalCard } from "./admin-approval";
import { requireWorkspace } from "@/server/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SmtpForm } from "./smtp-form";
import { BulkImport } from "./bulk-import";

export default async function NewAccountPage() {
  const { workspace } = await requireWorkspace("ADMIN");
  const sb = workspace.sendingEngine === "SALESBLINK";
  const googleReady = !!process.env.AUTH_GOOGLE_ID;
  const msReady = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

  if (sb && !workspace.salesblinkApiKeyEnc) {
    return (
      <>
        <PageHeader title="Connect inboxes" description="This workspace sends through SalesBlink." />
        <Card>
          <CardHeader>
            <CardTitle>Finish SalesBlink setup first</CardTitle>
            <CardDescription>Link this workspace to its SalesBlink workspace, then connect inboxes here.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/settings" className={buttonVariants()}>Go to Settings → SalesBlink</Link>
          </CardContent>
        </Card>
      </>
    );
  }

  if (sb) {
    return (
      <>
        <PageHeader title="Connect inboxes" description="Your workspace sends through SalesBlink, so inboxes are connected there and synced into MithMill." />
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Google Workspace / Gmail</CardTitle>
                <CardDescription>Sign in with Google. The inbox is added to this workspace&apos;s SalesBlink workspace and shows up here within a few minutes.</CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/api/salesblink/oauth/google" target="_blank" rel="noopener" className={buttonVariants({ variant: "gold" })}>
                  Connect Google ↗
                </a>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Microsoft 365 / Outlook</CardTitle>
                <CardDescription>Sign in with Microsoft. Added to this workspace&apos;s SalesBlink workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/api/salesblink/oauth/outlook" target="_blank" rel="noopener" className={buttonVariants({ variant: "gold" })}>
                  Connect Outlook ↗
                </a>
              </CardContent>
            </Card>
          </div>
          <Suspense fallback={null}>
            <AdminApprovalCard workspace={workspace} />
          </Suspense>
          <Card>
            <CardHeader>
              <CardTitle>SMTP / IMAP</CardTitle>
              <CardDescription>Or add an SMTP inbox here — MithMill passes the credentials to SalesBlink and doesn&apos;t store them.</CardDescription>
            </CardHeader>
            <CardContent>
              <SmtpForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bulk import (CSV)</CardTitle>
              <CardDescription>Upload many SMTP inboxes at once. They are added to this workspace&apos;s SalesBlink workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <BulkImport />
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            Workspace in SalesBlink: <b>{workspace.salesblinkWorkspaceName ?? "linked"}</b>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Connect inboxes" description="Add as many inboxes as you like — volume is spread across all of them." />
      <p className="mb-6 rounded-md bg-royal-50 px-3 py-2 text-sm text-royal-900">
        Sending through <b>SalesBlink</b>? Switch the engine in{" "}
        <Link href="/settings" className="font-medium underline">Settings → Sending engine</Link>. Inboxes are then connected on SalesBlink&apos;s page and
        synced here, with no Google/Microsoft app keys needed.
      </p>
      <div className="grid gap-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Google Workspace</CardTitle>
              <CardDescription>One-click OAuth. No app password needed.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/api/oauth/google/start"
                aria-disabled={!googleReady}
                className={cn(buttonVariants({ variant: "outline" }), !googleReady && "pointer-events-none opacity-50")}
              >
                Connect with Google
              </Link>
              {!googleReady && <p className="mt-2 text-xs text-muted-foreground">Set AUTH_GOOGLE_ID / SECRET to enable.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Microsoft 365 / Outlook</CardTitle>
              <CardDescription>One-click OAuth via Microsoft Entra ID.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/api/oauth/microsoft/start"
                aria-disabled={!msReady}
                className={cn(buttonVariants({ variant: "outline" }), !msReady && "pointer-events-none opacity-50")}
              >
                Connect with Microsoft
              </Link>
              {!msReady && <p className="mt-2 text-xs text-muted-foreground">Set AUTH_MICROSOFT_ENTRA_ID_ID / SECRET to enable.</p>}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>SMTP / IMAP</CardTitle>
            <CardDescription>Any provider. Credentials are encrypted with AES-256-GCM before they are stored.</CardDescription>
          </CardHeader>
          <CardContent>
            <SmtpForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bulk import (CSV)</CardTitle>
            <CardDescription>Connect hundreds of SMTP inboxes at once.</CardDescription>
          </CardHeader>
          <CardContent>
            <BulkImport />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
