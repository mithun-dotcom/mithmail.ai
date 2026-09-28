import Link from "next/link";
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

  if (sb) {
    return (
      <>
        <PageHeader title="Connect inboxes" description="Your workspace sends through SalesBlink, so inboxes are connected there and synced into MithMill." />
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Google, Microsoft or any SMTP inbox</CardTitle>
              <CardDescription>Opens SalesBlink&apos;s secure connection page. Connected inboxes appear here automatically (or click Sync on the Email accounts page).</CardDescription>
            </CardHeader>
            <CardContent>
              <a href="/api/salesblink/connect" target="_blank" rel="noopener" className={buttonVariants({ variant: "gold" })}>
                Connect in SalesBlink ↗
              </a>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>SMTP / IMAP</CardTitle>
              <CardDescription>Or add an SMTP inbox here — MithMill passes the credentials to SalesBlink and doesn&apos;t store them.</CardDescription>
            </CardHeader>
            <CardContent>
              <SmtpForm />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Connect inboxes" description="Add as many inboxes as you like — volume is spread across all of them." />
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
