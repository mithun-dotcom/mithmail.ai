import Link from "next/link";
import { signOut } from "@/auth";
import { requireWorkspace } from "@/server/workspace";
import { Logo } from "@/components/logo";
import { SidebarNav } from "@/components/sidebar-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-royal-950 text-royal-100">
        <div className="px-5 py-5">
          <Logo light />
        </div>
        <Link
          href="/workspaces"
          className="mx-3 mb-4 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
        >
          <span className="block text-[11px] uppercase tracking-wider text-royal-300">Workspace</span>
          <span className="block truncate font-medium text-white">{workspace.name}</span>
        </Link>
        <SidebarNav />
        <div className="mt-auto border-t border-white/10 p-4 text-sm">
          <p className="truncate text-royal-200">{user.email}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="mt-1 text-xs text-royal-300 hover:text-gold-300">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-muted/40">
        <div className="mx-auto max-w-7xl p-8">{children}</div>
      </main>
    </div>
  );
}
