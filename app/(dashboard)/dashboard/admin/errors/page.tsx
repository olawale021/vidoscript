"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader, Segmented } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { Dot, Spark, Table, ago, type ToneKind } from "../_components/bits";
import { useUserProfiles } from "../_components/use-user-profiles";

const KIND: Record<string, { label: string; pill: string; tone?: ToneKind; tip: string }> = {
  quota: {
    label: "Quota / billing",
    pill: "bg-bad/14 text-bad",
    tone: "bad",
    tip: "An API ran out of free quota or credit — check billing for that provider.",
  },
  rate_limit: {
    label: "Rate limit",
    pill: "bg-accent-soft text-accent",
    tone: "warn",
    tip: "Too many requests at once — usually clears by itself; retried automatically.",
  },
  auth: { label: "Auth / key", pill: "bg-bad/14 text-bad", tone: "bad", tip: "An API key is missing, wrong or expired." },
  timeout: { label: "Timeout", pill: "bg-accent-soft text-accent", tone: "warn", tip: "A provider took too long to answer." },
  other: { label: "Other", pill: "bg-surface-3 text-muted", tip: "" },
};
const SEVERITY = ["quota", "auth", "timeout", "rate_limit", "other"];
const RANGES = ["1", "7", "30"] as const;
const DAY = 86400_000;

function KindPill({ kind }: { kind: string }) {
  const k = KIND[kind] ?? KIND.other;
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold", k.pill)}>{k.label}</span>;
}

export default function AdminErrorsPage() {
  const [days, setDays] = useState(7);
  const [showResolved, setShowResolved] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const data = useQuery(api.errors.list, { days, includeResolved: showResolved });
  const resolveAll = useMutation(api.errors.resolveAll);
  const profiles = useUserProfiles(data?.rows.map((r) => r.userId ?? "") ?? []);

  if (data === undefined) return <Loader2 className="animate-spin text-faint" />;

  // Group individual error events into issues (same kind, feature, source and message).
  type Row = (typeof data.rows)[number];
  const groups = new Map<string, { key: string; kind: string; latest: Row; rows: Row[]; users: Set<string> }>();
  for (const r of data.rows) {
    const kind = r.kind ?? "other";
    const key = `${kind}|${r.feature}|${r.source}|${r.message}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, kind, latest: r, rows: [], users: new Set() };
      groups.set(key, g);
    }
    g.rows.push(r);
    if (r.userId) g.users.add(r.userId);
    if (r.createdAt > g.latest.createdAt) g.latest = r;
  }
  const issues = [...groups.values()]
    .map((g) => ({ ...g, resolved: g.rows.every((r) => r.resolved) }))
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.latest.createdAt - a.latest.createdAt);
  const open = issues.filter((i) => !i.resolved);
  const attention = [...open].sort(
    (a, b) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind) || b.rows.length - a.rows.length
  );
  const shown = kindFilter ? issues.filter((i) => i.kind === kindFilter) : issues;

  // Trend buckets across the selected window (2h buckets for 1 day, else daily).
  const buckets = days === 1 ? 12 : days;
  const bucketMs = (days * DAY) / buckets;
  const start = Date.now() - days * DAY;
  const trend = (rows: Row[]) => {
    const out = new Array<number>(buckets).fill(0);
    for (const r of rows) {
      const i = Math.floor((r.createdAt - start) / bucketMs);
      if (i >= 0 && i < buckets) out[i]++;
    }
    return out;
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {open.length > 0 && (
        <div className="grid gap-3 rounded-[12px] border border-bad/35 bg-gradient-to-b from-bad/7 to-transparent p-4">
          <h3 className="text-base font-semibold">
            {open.length} problem{open.length === 1 ? "" : "s"} need{open.length === 1 ? "s" : ""} you
          </h3>
          <ul className="grid gap-2">
            {attention.slice(0, 4).map((i) => (
              <li key={i.key} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm text-muted">
                <KindPill kind={i.kind} />
                <span className="min-w-0 flex-1 basis-60 break-words">
                  <b className="font-semibold text-fg">{i.latest.feature}</b> failed {i.rows.length}×, last {ago(i.latest.createdAt)}.{" "}
                  {KIND[i.kind]?.tip || <span className="text-faint">{i.latest.message.slice(0, 140)}</span>}
                </span>
              </li>
            ))}
          </ul>
          {attention.length > 4 && <span className="text-xs text-faint">+{attention.length - 4} more below</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {SEVERITY.map((k) => {
          const n = data.byKind[k] ?? 0;
          const pressed = kindFilter === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={pressed}
              onClick={() => setKindFilter(pressed ? null : k)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition",
                pressed ? "border-fg bg-surface-3 text-fg" : "border-line bg-surface text-muted hover:text-fg"
              )}
            >
              <Dot tone={n > 0 ? KIND[k].tone : undefined} />
              {KIND[k].label} <b className="text-fg tabular">{n}</b>
            </button>
          );
        })}
      </div>

      <Panel>
        <PanelHeader title={kindFilter ? `Issues · ${KIND[kindFilter]?.label ?? kindFilter}` : "Issues"}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              label="Range"
              className="flex-nowrap font-mono"
              value={String(days) as (typeof RANGES)[number]}
              options={RANGES.map((d) => ({ value: d, label: `${d}d` }))}
              onChange={(d) => setDays(Number(d))}
            />
            <label className="inline-flex items-center gap-1.5 text-xs text-faint">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Show resolved
            </label>
            <Button size="sm" variant="ghost" disabled={data.total === 0} onClick={() => resolveAll({})}>
              Mark all resolved
            </Button>
          </div>
        </PanelHeader>
        <Table
          cols={[
            { label: "Issue" },
            { label: `Trend · ${days}d` },
            { label: "Events", num: true },
            { label: "Users", num: true },
            { label: "Last seen", num: true },
          ]}
          empty={`No ${showResolved ? "" : "open "}issues in the last ${days === 1 ? "day" : `${days} days`}.`}
          rows={shown.map((i) => {
            const r = i.latest;
            const uid = i.users.size === 1 ? [...i.users][0] : r.userId;
            const p = uid ? profiles[uid] : undefined;
            return {
              key: i.key,
              className: i.resolved ? "resolved" : undefined,
              cells: [
                <div key="i" className="min-w-0 sm:min-w-[280px]">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                    <KindPill kind={i.kind} />
                    <span className="font-mono text-muted">{r.feature}</span>
                    <span>{r.source}</span>
                    {uid && (
                      <Link href={`/dashboard/admin/users/${uid}`} className="hover:text-fg hover:underline">
                        · {p?.email ?? p?.name ?? `${uid.slice(0, 14)}…`}
                        {i.users.size > 1 && ` +${i.users.size - 1}`}
                      </Link>
                    )}
                    {r.sourceId && (
                      <Link href={`/dashboard/clips/${r.sourceId}`} className="text-accent hover:underline">
                        · video
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 break-words leading-snug text-fg">{r.message}</div>
                </div>,
                <Spark key="s" values={trend(i.rows)} />,
                i.rows.length,
                i.users.size,
                ago(r.createdAt),
              ],
            };
          })}
        />
      </Panel>

      {Object.keys(data.byFeature).length > 0 && (
        <Panel>
          <PanelHeader title="By feature">
            <span className="text-xs text-faint">
              {data.total} event{data.total === 1 ? "" : "s"} · {days}d
            </span>
          </PanelHeader>
          <div className="flex flex-wrap gap-2 p-4 text-xs">
            {Object.entries(data.byFeature)
              .sort((a, b) => b[1] - a[1])
              .map(([f, n]) => (
                <span key={f} className="rounded-full border border-line px-2.5 py-1 font-mono text-muted">
                  {f} <b className="text-fg tabular">{n}</b>
                </span>
              ))}
          </div>
        </Panel>
      )}

      {data.rows.length < data.total && (
        <span className="text-xs text-faint">Issues grouped from the latest {data.rows.length} of {data.total} events.</span>
      )}
    </div>
  );
}
