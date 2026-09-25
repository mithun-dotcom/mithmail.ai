"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function CampaignTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/campaigns/${id}`, label: "Analytics" },
    { href: `/campaigns/${id}/sequence`, label: "Sequence" },
    { href: `/campaigns/${id}/leads`, label: "Leads" },
    { href: `/campaigns/${id}/schedule`, label: "Schedule" },
    { href: `/campaigns/${id}/settings`, label: "Settings" },
  ];
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
            pathname === t.href ? "border-royal-600 font-medium text-royal-900" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
