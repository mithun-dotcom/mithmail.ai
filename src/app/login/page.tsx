import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, enabledProviders, signIn } from "@/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ "check-email"?: string; error?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/workspaces");
  const { "check-email": checkEmail, error } = await searchParams;

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
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">Wrong email or password.</p>}
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
            {enabledProviders.admin && (
              <form
                className="space-y-2"
                action={async (fd: FormData) => {
                  "use server";
                  try {
                    await signIn("admin", { email: fd.get("email"), password: fd.get("password"), redirectTo: "/workspaces" });
                  } catch (e) {
                    if (e instanceof AuthError) redirect("/login?error=invalid");
                    throw e; // Next.js redirect on success
                  }
                }}
              >
                <Input name="email" type="email" placeholder="Admin email" required autoComplete="username" />
                <Input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
                <Button className="w-full">Sign in</Button>
              </form>
            )}
            {!enabledProviders.google && !enabledProviders.microsoft && !enabledProviders.email && !enabledProviders.admin && !enabledProviders.dev && (
              <p className="text-center text-sm text-muted-foreground">
                No sign-in method is configured. Set ADMIN_LOGIN_EMAIL and ADMIN_LOGIN_PASSWORD, or Google / Microsoft / email settings.
              </p>
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
