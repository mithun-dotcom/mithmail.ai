import { redirect } from "next/navigation";
import { auth, enabledProviders, signIn } from "@/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ "check-email"?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/workspaces");
  const { "check-email": checkEmail } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-royal-50 to-white p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>{checkEmail ? "Check your inbox for a sign-in link." : "Sign in to your MithMill account"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {enabledProviders.google && (
              <form action={async () => { "use server"; await signIn("google", { redirectTo: "/workspaces" }); }}>
                <Button variant="outline" className="w-full">Continue with Google</Button>
              </form>
            )}
            {enabledProviders.microsoft && (
              <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/workspaces" }); }}>
                <Button variant="outline" className="w-full">Continue with Microsoft</Button>
              </form>
            )}
            {enabledProviders.email && (
              <form
                className="space-y-2"
                action={async (fd: FormData) => {
                  "use server";
                  await signIn("nodemailer", { email: fd.get("email"), redirectTo: "/workspaces" });
                }}
              >
                <Input name="email" type="email" placeholder="you@company.com" required />
                <Button className="w-full">Email me a magic link</Button>
              </form>
            )}
            {enabledProviders.dev && (
              <form
                className="space-y-2 border-t pt-3"
                action={async (fd: FormData) => {
                  "use server";
                  await signIn("dev", { email: fd.get("email"), redirectTo: "/workspaces" });
                }}
              >
                <p className="text-xs text-muted-foreground">Development login (disabled in production)</p>
                <Input name="email" type="email" placeholder="dev@mithmill.test" required />
                <Button variant="secondary" className="w-full">Sign in (dev)</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
