"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "@/server/services/stats";

const INK = { grid: "#e7e8ee", tick: "#6b6f80", legend: "#3d4152" };
const SERIES_1 = "#2a78d6"; // categorical slot 1
const SERIES_2 = "#eb6834"; // categorical slot 2

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const axis = { tick: { fontSize: 12, fill: INK.tick }, axisLine: false, tickLine: false } as const;
const tooltipStyle = { borderRadius: 8, border: "1px solid #e2e5f0", fontSize: 12 };

export function SentBarChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap={2}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={24} {...axis} />
          <YAxis allowDecimals={false} width={40} {...axis} />
          <Tooltip labelFormatter={(l) => fmtDate(String(l))} contentStyle={tooltipStyle} cursor={{ fill: "#eef2ff" }} />
          <Bar dataKey="sent" name="Emails sent" fill={SERIES_1} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RatesLineChart({ data }: { data: DailyPoint[] }) {
  const rates = data.map((d) => ({
    date: d.date,
    openRate: d.sent ? Math.round((d.opened / d.sent) * 1000) / 10 : null,
    replyRate: d.sent ? Math.round((d.replied / d.sent) * 1000) / 10 : null,
  }));
  // A line needs two points; with sparse data show markers so single days are visible.
  const sparse = rates.filter((r) => r.openRate !== null).length <= 7;
  const dot = (fill: string) => (sparse ? { r: 4, strokeWidth: 2, stroke: "#fff", fill } : false);
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={rates} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={24} {...axis} />
          <YAxis unit="%" width={48} {...axis} />
          <Tooltip labelFormatter={(l) => fmtDate(String(l))} formatter={(v) => (v === null ? "—" : `${v}%`)} contentStyle={tooltipStyle} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: INK.legend }}>{v}</span>} />
          <Line type="monotone" dataKey="openRate" name="Open rate" stroke={SERIES_1} strokeWidth={2} dot={dot(SERIES_1)} connectNulls activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
          <Line type="monotone" dataKey="replyRate" name="Reply rate" stroke={SERIES_2} strokeWidth={2} dot={dot(SERIES_2)} connectNulls activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
