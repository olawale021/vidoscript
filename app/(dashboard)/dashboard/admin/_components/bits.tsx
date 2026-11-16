"use client";

import { cn } from "@/lib/utils";

export const usd = (n: number) =>
  n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function Panel({ title, children, className, right }: {
  title: string;
  children: React.ReactNode;
  className?: string;
  right?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-neutral-800 bg-neutral-950 p-4", className)}>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold mt-1 tabular-nums",
          tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-300" : "text-white"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

// 0..1 usage → tone
export const toneFor = (x: number): "ok" | "warn" | "bad" => (x >= 0.9 ? "bad" : x >= 0.7 ? "warn" : "ok");

export function Meter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-1.5 rounded-full bg-neutral-800 overflow-hidden mt-2">
      <div
        className={cn(
          "h-full rounded-full",
          v >= 0.9 ? "bg-red-400" : v >= 0.7 ? "bg-amber-300" : "bg-emerald-400"
        )}
        style={{ width: `${v * 100}%` }}
      />
    </div>
  );
}

// Simple vertical bars, labels under the first/last bar. values >= 0.
export function Bars({ data, format, height = 120 }: {
  data: { label: string; value: number }[];
  format: (n: number) => string;
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {data.map((d) => (
          <div
            key={d.label}
            title={`${d.label}: ${format(d.value)}`}
            className="flex-1 bg-sky-400/70 hover:bg-sky-300 rounded-t-sm min-h-[1px]"
            style={{ height: max > 0 ? `${(d.value / max) * 100}%` : "1px" }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
        <span>{data[0]?.label}</span>
        <span>max {format(max)}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

// Two 0..1 series over time (CPU load per core, memory used).
export function Lines({ points, height = 140 }: {
  points: { t: number; load: number; mem: number }[];
  height?: number;
}) {
  if (points.length < 2) {
    return <div className="text-sm text-neutral-500">Not enough heartbeats yet (one every 30 s).</div>;
  }
  const w = 600;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v: number) => height - Math.max(0, Math.min(1.2, v)) / 1.2 * height;
  const path = (key: "load" | "mem") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <line x1={0} x2={w} y1={y(1)} y2={y(1)} stroke="#525252" strokeDasharray="4 4" />
        <path d={path("mem")} fill="none" stroke="#a78bfa" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={path("load")} fill="none" stroke="#38bdf8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
        <span>{new Date(t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="flex gap-3">
          <span className="text-sky-400">● CPU load / core</span>
          <span className="text-violet-400">● RAM used</span>
          <span>dashed = 100%</span>
        </span>
        <span>{new Date(t1).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  );
}

export function Table({ head, rows, empty }: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) return <div className="text-sm text-neutral-500">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
            {head.map((h, i) => (
              <th key={h} className={cn("py-2 pr-3 font-medium", i > 0 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-neutral-900">
              {r.map((c, j) => (
                <td key={j} className={cn("py-2 pr-3 text-neutral-300", j > 0 && "text-right tabular-nums")}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
