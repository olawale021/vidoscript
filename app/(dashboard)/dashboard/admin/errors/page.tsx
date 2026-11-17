"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Panel, Stat, ago } from "../_components/bits";
import { useUserProfiles } from "../_components/use-user-profiles";

const KIND: Record<string, { label: string; tone: string; tip: string }> = {
  quota: {
    label: "Quota / billing",
    tone: "bg-red-500/15 text-red-300",
    tip: "An API ran out of free quota or credit — check billing for that provider.",
  },
  rate_limit: {
    label: "Rate limit",
    tone: "bg-amber-500/15 text-amber-200",
    tip: "Too many requests at once — usually clears by itself; retried automatically.",
  },
  auth: { label: "Auth / key", tone: "bg-red-500/15 text-red-300", tip: "An API key is missing, wrong or expired." },
  timeout: { label: "Timeout", tone: "bg-amber-500/15 text-amber-200", tip: "A provider took too long to answer." },
  other: { label: "Other", tone: "bg-neutral-800 text-neutral-300", tip: "" },
};

export default function AdminErrorsPage() {
  const [days, setDays] = useState(7);
  const [showResolved, setShowResolved] = useState(false);
  const data = useQuery(api.errors.list, { days, includeResolved: showResolved });
  const resolveAll = useMutation(api.errors.resolveAll);
  const profiles = useUserProfiles(data?.rows.map((r) => r.userId ?? "") ?? []);

  if (data === undefined) return <Loader2 className="animate-spin text-neutral-500" />;

  const kinds = Object.entries(data.byKind).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={`Errors (${days}d)`} value={data.total} tone={data.total > 0 ? "warn" : "ok"} />
        {(["quota", "rate_limit", "auth"] as const).map((k) => (
          <Stat key={k} label={KIND[k].label} value={data.byKind[k] ?? 0} tone={(data.byKind[k] ?? 0) > 0 ? "bad" : "ok"} />
        ))}
      </div>

      {kinds.some(([k]) => k === "quota" || k === "auth") && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 space-y-1">
          {kinds
            .filter(([k]) => k === "quota" || k === "auth")
            .map(([k]) => (
              <div key={k}>
                <b>{KIND[k].label}:</b> {KIND[k].tip}
              </div>
            ))}
        </div>
      )}

      <Panel
        title="Recent errors"
        right={
          <div className="flex items-center gap-2">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn("text-xs px-2 py-1 rounded", days === d ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-white")}
              >
                {d}d
              </button>
            ))}
            <label className="text-xs text-neutral-500 inline-flex items-center gap-1 ml-2">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              resolved
            </label>
            <Button size="sm" variant="outline" disabled={data.total === 0} onClick={() => resolveAll({})}>
              Mark all resolved
            </Button>
          </div>
        }
      >
        {data.rows.length === 0 ? (
          <div className="text-sm text-neutral-500">No errors. 🎉</div>
        ) : (
          <ul className="divide-y divide-neutral-900">
            {data.rows.map((r) => {
              const k = KIND[r.kind ?? "other"] ?? KIND.other;
              const p = r.userId ? profiles[r.userId] : undefined;
              return (
                <li key={r._id} className={cn("py-3 space-y-1", r.resolved && "opacity-50")}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("px-2 py-0.5 rounded-full font-medium", k.tone)}>{k.label}</span>
                    <span className="font-mono text-neutral-300">{r.feature}</span>
                    <span className="text-neutral-500">{r.source}</span>
                    <span className="text-neutral-500">· {ago(r.createdAt)}</span>
                    {r.userId && (
                      <Link href={`/dashboard/admin/users/${r.userId}`} className="text-neutral-400 hover:text-white hover:underline">
                        · {p?.email ?? p?.name ?? r.userId.slice(0, 14)}
                      </Link>
                    )}
                    {r.sourceId && (
                      <Link href={`/dashboard/clips/${r.sourceId}`} className="text-sky-300 hover:underline">
                        · video
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-neutral-300 break-words">{r.message}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {Object.keys(data.byFeature).length > 0 && (
        <Panel title="By feature">
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(data.byFeature)
              .sort((a, b) => b[1] - a[1])
              .map(([f, n]) => (
                <span key={f} className="px-2 py-1 rounded bg-neutral-900 text-neutral-300">
                  {f} <b className="text-white">{n}</b>
                </span>
              ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
