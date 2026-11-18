"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, Segmented, StatRow } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { BarChart, Dot, Gauge, Legend, LineChart, Note, ago, clock, duration, gb, toneFor } from "./_components/bits";

const RANGES = ["1", "6", "24", "48"] as const;

export default function AdminSystemPage() {
  const latest = useQuery(api.system.latest);
  const [hours, setHours] = useState(6);
  const history = useQuery(api.system.history, { hours });
  const renders = useQuery(api.system.renderStats);

  if (latest === undefined || renders === undefined) {
    return <Loader2 className="animate-spin text-faint" />;
  }

  const stale = !latest || Date.now() - latest.createdAt > 90_000;
  const loadPerCore = latest ? latest.loadAvg1 / Math.max(1, latest.cpuCount) : null;
  const memUsed = latest ? 1 - latest.memAvailable / latest.memTotal : null;
  const swapUsed = latest ? (latest.swapTotal > 0 ? 1 - latest.swapFree / latest.swapTotal : 0) : null;
  const diskUsed = latest ? 1 - latest.diskFree / latest.diskTotal : null;
  const finished = renders.done7d + renders.failed7d;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {stale && (
        <div className="flex items-start gap-2.5 rounded-[12px] border border-accent/35 bg-accent-soft px-4 py-3 text-sm text-accent">
          <Dot tone="warn" className="mt-1.5" />
          {latest
            ? `No heartbeat from the render worker for ${ago(latest.createdAt).replace(" ago", "")}. It may be down.`
            : "No heartbeats yet. The render worker sends one every 30 s once it's running."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Gauge
          label="CPU load"
          value={loadPerCore}
          tone={toneFor(loadPerCore ?? 0)}
          sub={latest && `${latest.loadAvg1.toFixed(2)} / ${latest.loadAvg5.toFixed(2)} / ${latest.loadAvg15.toFixed(2)} · ${latest.cpuCount} cores`}
        />
        <Gauge
          label="RAM"
          value={memUsed}
          tone={toneFor(memUsed ?? 0)}
          sub={latest && `${gb(latest.memTotal - latest.memAvailable).replace(" GB", "")} of ${gb(latest.memTotal)}`}
        />
        <Gauge
          label="Swap"
          value={swapUsed}
          tone={(swapUsed ?? 0) > 0.25 ? "warn" : "ok"}
          marks={[0.25]}
          sub={latest && `${gb(latest.swapTotal - latest.swapFree).replace(" GB", "")} of ${gb(latest.swapTotal)}`}
        />
        <Gauge
          label="Disk"
          value={diskUsed}
          tone={toneFor(diskUsed ?? 0)}
          sub={latest && `${gb(latest.diskFree)} free of ${gb(latest.diskTotal)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Server load">
            <Legend
              items={[
                { label: "CPU / core", color: "var(--color-fg)" },
                { label: "RAM", color: "var(--color-accent)" },
              ]}
            />
            <Segmented
              size="sm"
              label="Time range"
              className="flex-nowrap font-mono"
              value={String(hours) as (typeof RANGES)[number]}
              options={RANGES.map((h) => ({ value: h, label: `${h}h` }))}
              onChange={(h) => setHours(Number(h))}
            />
          </PanelHeader>
          <PanelBody>
            {history ? (
              <LineChart
                label="CPU load per core and RAM used over time"
                threshold={0.9}
                series={[
                  { color: "var(--color-fg)", fill: true, points: history.map((p) => ({ t: p.t, v: p.load })) },
                  { color: "var(--color-accent)", points: history.map((p) => ({ t: p.t, v: p.mem })) },
                ]}
              />
            ) : (
              <Loader2 className="animate-spin text-faint" />
            )}
            {latest && (
              <Note className="mt-2 block">
                Worker {latest.workerBusy ? "rendering" : "idle"} · last heartbeat {ago(latest.createdAt)} · dashed line = 90%
              </Note>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Recent render failures">
            <Note>7 days</Note>
          </PanelHeader>
          {renders.failures.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-faint">No failures.</div>
          ) : (
            <ul className="grid max-h-[340px] overflow-y-auto">
              {renders.failures.map((f, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[44px_12px_minmax(0,1fr)] items-start gap-2.5 border-t border-line px-4 py-[9px] text-[13px] first:border-t-0"
                >
                  <time className="pt-0.5 font-mono text-[11px] text-faint" title={new Date(f.at).toLocaleString()}>
                    {Date.now() - f.at < 86400_000 ? clock(f.at) : ago(f.at).replace(" ago", "")}
                  </time>
                  <Dot tone="bad" className="mt-[5px]" />
                  <div className="min-w-0">
                    <div className="break-words font-mono text-xs text-bad">{f.error ?? "unknown"}</div>
                    <small className="block text-xs text-faint">
                      {f.loadTest ? "Load test" : "User"} · <span className="font-mono">{f.userId.slice(0, 12)}…</span>
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <StatRow
        items={[
          { k: "Queued renders", v: <span className={cn(renders.queued > 5 && "text-accent")}>{renders.queued}</span> },
          { k: "Rendering now", v: renders.rendering },
          {
            k: "Avg render · 7d",
            v: duration(renders.avgSeconds),
            d: `p95 ${duration(renders.p95Seconds)} · ${renders.timedRenders} timed`,
            flat: true,
          },
          {
            k: "Done · 7d",
            v: renders.done7d,
            d: finished > 0 ? `${Math.round((renders.done7d / finished) * 100)}% success` : undefined,
          },
          {
            k: "Failed · 7d",
            v: <span className={cn(renders.failed7d > 0 && "text-bad")}>{renders.failed7d}</span>,
          },
        ]}
      />

      <LoadTestPanel />
    </div>
  );
}

function LoadTestPanel() {
  const status = useQuery(api.admin.loadTestStatus);
  const queue = useMutation(api.admin.queueTestRenders);
  const clear = useMutation(api.admin.clearTestRenders);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  };

  const durations = (status?.recent ?? [])
    .filter((r) => r.status === "done" && r.startedAt && r.finishedAt)
    .reverse()
    .map((r, i) => {
      const s = (r.finishedAt! - r.startedAt!) / 1000;
      return { label: `#${i + 1}`, value: s / 60, title: `#${i + 1} · ${duration(s)}` };
    });

  return (
    <Panel>
      <PanelHeader title="Load test">
        {status?.source && (
          <Note>
            Source plan: {status.source.scenes} scenes · updated {ago(status.source.updatedAt)}
          </Note>
        )}
      </PanelHeader>
      <PanelBody className="grid gap-3.5">
        <p className="text-[13px] text-muted">
          Queues copies of your latest B-roll plan as test renders. They never show up in your projects. Watch the
          gauges and load chart while they run.
        </p>
        {status === undefined ? (
          <Loader2 className="animate-spin text-faint" />
        ) : !status.source ? (
          <div className="text-sm text-accent">Make a B-roll plan in one of your projects first.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {[1, 3, 5, 10].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(async () => `Queued ${await queue({ count: n })} test render(s).`)}
                >
                  Queue {n}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || status.total === 0}
                onClick={() => run(async () => `Removed ${await clear({})} test render(s).`)}
              >
                Clear test renders
              </Button>
            </div>
            {message && <div className="text-sm text-muted">{message}</div>}
            <div className="grid grid-cols-2 gap-2 text-[13px] text-faint sm:grid-cols-4">
              {(
                [
                  ["Queued", status.queued],
                  ["Rendering", status.rendering],
                  ["Done", status.done],
                  ["Failed", status.failed],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  {k}
                  <b className={cn("block text-lg font-semibold text-fg tabular", k === "Failed" && v > 0 && "text-bad")}>{v}</b>
                </div>
              ))}
            </div>
            {durations.length > 0 && (
              <div>
                <Note className="mb-1.5 block">Render time per test job, oldest to newest</Note>
                <BarChart
                  label="Render time per test job"
                  data={durations}
                  height={120}
                  fmtY={(m) => `${Number(m.toFixed(1))}m`}
                />
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
