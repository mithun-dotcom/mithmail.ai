"use client";

import { cn } from "@/lib/utils";

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-royal-950">{title}</h3>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-sm font-medium text-royal-900">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Switch({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-6 w-11 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-royal-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
      />
      <span className="text-sm font-medium text-royal-900">{label}</span>
    </label>
  );
}

export function Tile({
  icon,
  label,
  value,
  count,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  count?: number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-gradient-to-br from-white to-royal-50/60 p-4 shadow-sm" title={hint}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-royal-100 text-royal-700">{icon}</span>
        <p className="text-sm leading-tight text-muted-foreground">{label}</p>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <p className="text-2xl font-semibold tabular-nums text-royal-700">{value}</p>
        {count !== undefined && <p className="text-sm tabular-nums text-muted-foreground">{count}</p>}
      </div>
    </div>
  );
}
