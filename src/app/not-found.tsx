import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-b from-royal-50 to-white p-6 text-center">
      <Logo />
      <h1 className="mt-6 text-2xl font-semibold text-royal-950">Page not found</h1>
      <p className="text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
      <Link href="/dashboard" className={buttonVariants()}>Back to dashboard</Link>
    </main>
  );
}
