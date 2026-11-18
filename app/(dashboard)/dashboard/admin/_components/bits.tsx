"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export const usd = (n: number) =>
  n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export type ToneKind = "ok" | "warn" | "bad";

// 0..1 usage → tone
export const toneFor = (x: number): ToneKind => (x >= 0.9 ? "bad" : x >= 0.7 ? "warn" : "ok");

export function Note({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("text-xs text-faint", className)}>{children}</span>;
}

export function Dot({ tone, className }: { tone?: ToneKind; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 flex-shrink-0 rounded-full",
        tone === "ok" && "bg-ok shadow-[0_0_0_3px_rgba(95,211,154,.15)]",
        tone === "warn" && "bg-accent shadow-[0_0_0_3px_var(--color-accent-soft)]",
        tone === "bad" && "bg-bad shadow-[0_0_0_3px_rgba(242,114,122,.15)]",
        !tone && "bg-faint",
        className
      )}
    />
  );
}

// Gauge card: label + tone pill, big value, meter with threshold marks, sub line.
export function Gauge({ label, value, tone, sub, marks = [0.7, 0.9] }: {
  label: string;
  value: number | null;
  tone: ToneKind;
  sub?: React.ReactNode;
  marks?: number[];
}) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <div className="grid min-w-0 gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between text-xs text-faint">
        <span>{label}</span>
        {value !== null && (
          <span
            className={cn(
              "rounded-full px-[7px] py-px text-[11px] font-semibold",
              tone === "ok" && "bg-ok/12 text-ok",
              tone === "warn" && "bg-accent-soft text-accent",
              tone === "bad" && "bg-bad/14 text-bad"
            )}
          >
            {tone === "ok" ? "Normal" : tone === "warn" ? "High" : "Critical"}
          </span>
        )}
      </div>
      <span className="text-[28px] font-semibold leading-none tracking-[-0.03em] tabular">
        {value === null ? "—" : pct(value)}
      </span>
      <div className="relative h-1.5 rounded-[3px] bg-surface-3">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-[3px]",
            tone === "ok" ? "bg-fg" : tone === "warn" ? "bg-accent" : "bg-bad"
          )}
          style={{ width: `${v * 100}%` }}
        />
        {marks.map((m) => (
          <i key={m} className="absolute -top-[3px] -bottom-[3px] w-px bg-line-strong" style={{ left: `${m * 100}%` }} />
        ))}
      </div>
      {sub && <span className="truncate font-mono text-xs text-faint">{sub}</span>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3.5 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className="h-[3px] w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// Pill-shaped filter toggle ("filter" in the prototype).
export function Pill({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-[5px] text-[13px] transition",
        pressed ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}

// ---------- tables ----------

export type Col = { label: string; num?: boolean; wide?: boolean };
export type Row = { key: string; cells: React.ReactNode[]; href?: string; className?: string };

export function Table({ cols, rows, empty }: { cols: Col[]; rows: Row[]; empty: string }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="adm-tbl">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} className={c.num ? "num" : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="!py-7 text-center !text-faint">{empty}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.key}
                className={cn(r.href && "link", r.className)}
                onClick={r.href ? (e) => {
                  // Let real links/buttons inside the row handle their own clicks.
                  if ((e.target as HTMLElement).closest("a,button,input")) return;
                  router.push(r.href!);
                } : undefined}
              >
                {r.cells.map((c, j) => (
                  <td
                    key={j}
                    data-l={cols[j]?.label ?? ""}
                    data-wide={cols[j]?.wide ? "" : undefined}
                    className={cols[j]?.num ? "num" : undefined}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Cost with a little share-of-max bar in front.
export function Share({ value, max, label }: { value: number; max: number; label?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-end">
      <span className="adm-share mr-2 inline-block h-1 w-16 overflow-hidden rounded-sm bg-surface-3 align-middle">
        <b className="block h-full bg-muted" style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }} />
      </span>
      {label ?? usd(value)}
    </span>
  );
}

const AVATAR = ["#f2b84b", "#6fa8ff", "#5fd39a", "#f27a9c", "#c9a7ff", "#a3a3a8", "#ffd88a", "#7fd1d6"];

export function initialsOf(text: string) {
  const parts = text.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function Initials({ id, text, size = 28 }: { id: string; text: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (
    <span
      aria-hidden
      className="grid flex-shrink-0 place-items-center rounded-full font-bold text-[#111]"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6), background: AVATAR[h % AVATAR.length] }}
    >
      {initialsOf(text)}
    </span>
  );
}

export function Who({ id, name, email }: { id: string; name?: string | null; email?: string | null }) {
  const primary = name ?? email ?? id;
  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:min-w-[180px]">
      <Initials id={id} text={primary} />
      <div className="min-w-0">
        <div className="truncate text-fg">{primary}</div>
        {name && email && <small className="block truncate text-xs text-faint">{email}</small>}
      </div>
    </div>
  );
}

export const statusTone = (s: string) =>
  s === "failed" ? "text-bad" : s === "done" || s === "ready" ? "text-ok" : "text-accent";

export function Status({ s }: { s: string }) {
  return <span className={cn("text-xs font-semibold", statusTone(s))}>{s}</span>;
}

// ---------- charts (inline SVG, scale with viewBox) ----------

const PAD = { l: 40, r: 10, t: 10, b: 24 };
const W = 640;

export function LineChart({ series, height = 220, threshold, label }: {
  series: { color: string; fill?: boolean; points: { t: number; v: number }[] }[];
  height?: number;
  threshold?: number;
  label: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return <div className="py-8 text-center text-sm text-faint">Not enough heartbeats yet (one every 30 s).</div>;
  }
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const peak = Math.max(1, ...all.map((p) => p.v));
  const step = peak > 1.5 ? 0.5 : 0.25;
  const max = Math.ceil(peak / step) * step;
  const iw = W - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v: number) => PAD.t + ih - (Math.max(0, v) / max) * ih;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  const span = t1 - t0;
  const fmtT = (t: number) =>
    span > 24 * 3600_000
      ? `${new Date(t).toLocaleDateString([], { weekday: "short" })} ${new Date(t).getHours()}:00`
      : clock(t);
  const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * span);

  return (
    <svg className="adm-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
          <text x={PAD.l - 8} y={y(v) + 3} textAnchor="end">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {threshold !== undefined && (
        <line x1={PAD.l} x2={W - PAD.r} y1={y(threshold)} y2={y(threshold)} stroke="var(--color-bad)" strokeDasharray="3 4" opacity={0.5} />
      )}
      {labels.map((t, i) => (
        <text key={i} x={x(t)} y={height - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>
          {fmtT(t)}
        </text>
      ))}
      {series.map((s, i) => {
        if (s.points.length < 2) return null;
        const d = s.points.map((p, j) => `${j ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
        const last = s.points[s.points.length - 1];
        return (
          <g key={i}>
            {s.fill && (
              <path d={`${d}L${x(last.t)} ${y(0)}L${x(s.points[0].t)} ${y(0)}Z`} fill={s.color} opacity={0.08} />
            )}
            <path d={d} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" />
            <circle cx={x(last.t)} cy={y(last.v)} r={3} fill={s.color} />
          </g>
        );
      })}
    </svg>
  );
}

export function BarChart({ data, height = 220, color = "var(--color-muted)", fmtY, label, every }: {
  data: { label: string; value: number; title?: string }[];
  height?: number;
  color?: string;
  fmtY: (n: number) => string;
  label: string;
  every?: number;
}) {
  if (data.length === 0) return null;
  const peak = Math.max(...data.map((d) => d.value), 0);
  const raw = peak > 0 ? peak / 4 : 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const max = Math.max(step, Math.ceil(peak / step) * step);
  const iw = W - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const bw = iw / data.length;
  const gap = Math.max(1, bw * 0.22);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  const labelEvery = every ?? (data.length <= 7 ? 1 : data.length <= 31 ? 5 : 15);

  return (
    <svg className="adm-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
          <text x={PAD.l - 8} y={y(v) + 3} textAnchor="end">{fmtY(v)}</text>
        </g>
      ))}
      {data.map((d, i) =>
        d.value > 0 ? (
          <rect
            key={i}
            x={PAD.l + i * bw + gap / 2}
            y={y(d.value)}
            width={bw - gap}
            height={Math.max(0.5, y(0) - y(d.value))}
            fill={color}
            rx={1.5}
          >
            <title>{d.title ?? `${d.label}: ${fmtY(d.value)}`}</title>
          </rect>
        ) : null
      )}
      {data.map((d, i) =>
        i % labelEvery === 0 ? (
          <text key={`l${i}`} x={PAD.l + i * bw + bw / 2} y={height - 6} textAnchor="middle">{d.label}</text>
        ) : null
      )}
    </svg>
  );
}

export function Spark({ values }: { values: number[] }) {
  const w = 72;
  const h = 22;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="inline-block">
      <polyline points={pts} fill="none" stroke="var(--color-muted)" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}
