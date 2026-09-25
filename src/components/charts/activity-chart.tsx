"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "@/server/services/stats";

// Categorical slots 1-3 of the validated reference palette (fixed order).
const SERIES = [
  { key: "sent", label: "Sent", color: "#2a78d6" },
  { key: "opened", label: "Opened", color: "#eb6834" },
  { key: "replied", label: "Replied", color: "#1baf7a" },
] as const;

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ActivityChart({ data }: { data: DailyPoint[] }) {
  return (
    <div>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#e7e8ee" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 12, fill: "#6b6f80" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#6b6f80" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              labelFormatter={(l) => fmtDate(String(l))}
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e5f0", fontSize: 12 }}
              cursor={{ stroke: "#9aa0b4", strokeWidth: 1 }}
            />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: "#3d4152" }}>{v}</span>} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-1">Date</th>{SERIES.map((s) => <th key={s.key}>{s.label}</th>)}<th>Bounced</th></tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="py-1">{fmtDate(d.date)}</td>
                  <td>{d.sent}</td><td>{d.opened}</td><td>{d.replied}</td><td>{d.bounced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
