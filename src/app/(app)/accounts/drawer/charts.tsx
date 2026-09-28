"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const axis = { tick: { fontSize: 12, fill: "#6b6f80" }, axisLine: false, tickLine: false } as const;
const tooltip = { labelFormatter: (l: unknown) => fmtDate(String(l)), contentStyle: { borderRadius: 8, border: "1px solid #e2e5f0", fontSize: 12 } };
const legend = { iconType: "square" as const, wrapperStyle: { fontSize: 12 }, formatter: (v: string) => <span style={{ color: "#3d4152" }}>{v}</span> };

export function DailySentChart({ data }: { data: { date: string; newLead: number; followUp: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#eef0f5" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={20} {...axis} />
          <YAxis allowDecimals={false} width={40} {...axis} />
          <Tooltip {...tooltip} cursor={{ fill: "#f3f4f9" }} />
          <Legend {...legend} verticalAlign="top" height={28} />
          <Bar dataKey="newLead" name="New lead" stackId="s" fill="#38bdf8" maxBarSize={28} />
          <Bar dataKey="followUp" name="Follow-up" stackId="s" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WarmupChart({ data }: { data: { date: string; sent: number; received: number; savedFromSpam: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="#eef0f5" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={20} {...axis} />
          <YAxis allowDecimals={false} width={40} {...axis} />
          <Tooltip {...tooltip} cursor={{ fill: "#f3f4f9" }} />
          <Legend {...legend} verticalAlign="top" height={28} />
          <Bar dataKey="sent" name="Sent" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="received" name="Received" fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line dataKey="savedFromSpam" name="Saved from spam" stroke="#f59e0b" strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
