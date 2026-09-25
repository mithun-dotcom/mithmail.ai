import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-sm font-bold text-gold-300 shadow">
        M
      </span>
      <span className={cn("text-lg", light ? "text-white" : "text-royal-950")}>
        Mith<span className="text-gold-400">Mill</span>
      </span>
    </Link>
  );
}
