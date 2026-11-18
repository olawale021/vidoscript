"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Panel, PanelHeader, Segmented } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { BarChart, Note, Share, Table, Who, usd } from "../_components/bits";
import { useUserProfiles } from "../_components/use-user-profiles";

const RANGES = ["7", "30", "90"] as const;

export default function AdminCostsPage() {
  const [days, setDays] = useState(30);
  const data = useQuery(api.usage.dashboard, { days });
  const profiles = useUserProfiles(data?.byUser.map((u) => u.key) ?? []);

  if (data === undefined) return <Loader2 className="animate-spin text-faint" />;

  const tokens = (g: { inputTokens: number; outputTokens: number }) => {
    const n = g.inputTokens + g.outputTokens;
    return n === 0 ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1000).toFixed(1)}k`;
  };
  const maxOf = (rows: { costUsd: number }[]) => Math.max(0, ...rows.map((r) => r.costUsd));
  const featMax = maxOf(data.byFeature);
  const modelMax = maxOf(data.byModel);
  const userMax = maxOf(data.byUser);

  // Tiles; the 7d / 30d ones also switch the chart range.
  const metrics: { k: string; v: string; days?: number }[] = [
    { k: "Today", v: usd(data.totals.today) },
    { k: "Last 7 days", v: usd(data.totals.last7), days: 7 },
    { k: "Last 30 days", v: usd(data.totals.last30), days: 30 },
    { k: `Calls · ${data.days}d`, v: data.calls.toLocaleString() },
    { k: "Avg per call", v: data.calls > 0 ? usd(data.totals.period / data.calls) : "—" },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Panel>
        <div className="grid grid-cols-2 border-b border-line sm:grid-cols-5">
          {metrics.map((m, i) => {
            const active = m.days === days;
            const cls = cn(
              "-mb-px grid min-w-0 gap-0.5 border-b-2 px-4 py-3.5 text-left",
              active ? "border-b-fg bg-surface-2" : "border-b-transparent",
              // borders between tiles: 2-up on phones, 5-up from sm
              "max-sm:[&:nth-child(even)]:border-l max-sm:[&:nth-child(n+3)]:border-t max-sm:last:col-span-2 max-sm:last:border-l-0",
              "sm:[&:not(:first-child)]:border-l",
              "border-l-line border-t-line"
            );
            const inner = (
              <>
                <span className="text-xs text-faint">{m.k}</span>
                <span className="truncate text-[22px] font-semibold tracking-tight tabular">{m.v}</span>
              </>
            );
            return m.days ? (
              <button key={i} type="button" aria-pressed={active} onClick={() => setDays(m.days!)} className={cn(cls, "hover:bg-surface-2")}>
                {inner}
              </button>
            ) : (
              <div key={i} className={cls}>{inner}</div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h3 className="text-sm font-semibold">Cost per day</h3>
          <Segmented
            size="sm"
            label="Range"
            className="flex-nowrap font-mono"
            value={String(days) as (typeof RANGES)[number]}
            options={RANGES.map((d) => ({ value: d, label: `${d}d` }))}
            onChange={(d) => setDays(Number(d))}
          />
        </div>
        <div className="px-4 pb-4">
          <BarChart
            label="AI cost per day"
            data={data.byDay.map((d) => ({
              label: `${Number(d.key.slice(5, 7))}/${Number(d.key.slice(8))}`,
              value: d.costUsd,
              title: `${d.key}: ${usd(d.costUsd)} · ${d.calls} calls`,
            }))}
            fmtY={(v) => (v === 0 ? "$0" : v < 1 ? `$${Number(v.toFixed(2))}` : `$${Number(v.toFixed(1))}`)}
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="By feature" />
          <Table
            cols={[{ label: "Feature" }, { label: "Calls", num: true }, { label: "Tokens", num: true }, { label: "Cost", num: true }]}
            empty="No AI calls yet."
            rows={data.byFeature.map((g) => ({
              key: g.key,
              cells: [
                <span key="f" className="text-fg">{g.key}</span>,
                g.calls.toLocaleString(),
                <span key="t" className="font-mono">{tokens(g)}</span>,
                <Share key="c" value={g.costUsd} max={featMax} />,
              ],
            }))}
          />
        </Panel>
        <Panel>
          <PanelHeader title="By model" />
          <Table
            cols={[{ label: "Model" }, { label: "Calls", num: true }, { label: "Tokens", num: true }, { label: "Cost", num: true }]}
            empty="No AI calls yet."
            rows={data.byModel.map((g) => ({
              key: g.key,
              cells: [
                <span key="m" className="break-all font-mono text-xs text-fg">{g.key}</span>,
                g.calls.toLocaleString(),
                <span key="t" className="font-mono">{tokens(g)}</span>,
                <Share key="c" value={g.costUsd} max={modelMax} />,
              ],
            }))}
          />
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Top spenders">
          <Link href="/dashboard/admin/users" className="text-xs text-faint hover:text-fg">
            All users →
          </Link>
        </PanelHeader>
        <Table
          cols={[{ label: "User" }, { label: "Calls", num: true }, { label: "Tokens", num: true }, { label: "Cost", num: true }]}
          empty="No AI calls yet."
          rows={data.byUser.map((g) => {
            const p = profiles[g.key];
            const anon = g.key === "anonymous";
            return {
              key: g.key,
              href: anon ? undefined : `/dashboard/admin/users/${g.key}`,
              cells: [
                anon ? (
                  <Who key="u" id="anonymous" name="anonymous" />
                ) : (
                  <Link key="u" href={`/dashboard/admin/users/${g.key}`} className="block">
                    <Who id={g.key} name={p?.name} email={p?.email ?? `${g.key.slice(0, 14)}…`} />
                  </Link>
                ),
                g.calls.toLocaleString(),
                <span key="t" className="font-mono">{tokens(g)}</span>,
                <Share key="c" value={g.costUsd} max={userMax} />,
              ],
            };
          })}
        />
      </Panel>

      <Note>
        Estimates from token counts × prices in <code className="font-mono text-muted">lib/ai-pricing.ts</code>. Check
        the OpenAI and Google billing pages for exact invoices.
      </Note>
    </div>
  );
}
