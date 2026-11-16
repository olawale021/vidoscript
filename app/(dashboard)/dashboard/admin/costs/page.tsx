"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Bars, Panel, Stat, Table, usd } from "../_components/bits";
import { useUserProfiles } from "../_components/use-user-profiles";

export default function AdminCostsPage() {
  const [days, setDays] = useState(30);
  const data = useQuery(api.usage.dashboard, { days });
  const profiles = useUserProfiles(data?.byUser.map((u) => u.key) ?? []);

  if (data === undefined) return <Loader2 className="animate-spin text-neutral-500" />;

  const tokens = (g: { inputTokens: number; outputTokens: number }) =>
    `${((g.inputTokens + g.outputTokens) / 1000).toFixed(1)}k`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Today" value={usd(data.totals.today)} />
        <Stat label="Last 7 days" value={usd(data.totals.last7)} />
        <Stat label="Last 30 days" value={usd(data.totals.last30)} />
        <Stat label={`Calls (${data.days}d)`} value={data.calls} />
      </div>

      <Panel
        title="Cost per day"
        right={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`text-xs px-2 py-1 rounded ${days === d ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-white"}`}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      >
        <Bars data={data.byDay.map((d) => ({ label: d.key.slice(5), value: d.costUsd }))} format={usd} />
      </Panel>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="By feature">
          <Table
            head={["Feature", "Calls", "Tokens", "Cost"]}
            empty="No AI calls yet."
            rows={data.byFeature.map((g) => [g.key, g.calls, tokens(g), usd(g.costUsd)])}
          />
        </Panel>
        <Panel title="By model">
          <Table
            head={["Model", "Calls", "Tokens", "Cost"]}
            empty="No AI calls yet."
            rows={data.byModel.map((g) => [g.key, g.calls, tokens(g), usd(g.costUsd)])}
          />
        </Panel>
      </div>

      <Panel title="By user">
        <Table
          head={["User", "Calls", "Tokens", "Cost"]}
          empty="No AI calls yet."
          rows={data.byUser.map((g) => [
            g.key === "anonymous" ? (
              "anonymous"
            ) : (
              <Link key="u" href={`/dashboard/admin/users/${g.key}`} className="hover:text-white underline-offset-2 hover:underline">
                {profiles[g.key]?.email ?? profiles[g.key]?.name ?? `${g.key.slice(0, 14)}…`}
              </Link>
            ),
            g.calls,
            tokens(g),
            usd(g.costUsd),
          ])}
        />
      </Panel>

      <p className="text-xs text-neutral-500">
        Costs are estimates from token counts × prices in <code>lib/ai-pricing.ts</code>. Check your OpenAI and
        Google billing pages for exact invoices.
      </p>
    </div>
  );
}
