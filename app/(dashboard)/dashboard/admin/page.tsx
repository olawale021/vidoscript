"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Bars, Lines, Meter, Panel, Stat, Table, ago, duration, gb, pct, toneFor } from "./_components/bits";

export default function AdminSystemPage() {
  const latest = useQuery(api.system.latest);
  const [hours, setHours] = useState(6);
  const history = useQuery(api.system.history, { hours });
  const renders = useQuery(api.system.renderStats);

  if (latest === undefined || renders === undefined) {
    return <Loader2 className="animate-spin text-neutral-500" />;
  }

  const stale = !latest || Date.now() - latest.createdAt > 90_000;
  const loadPerCore = latest ? latest.loadAvg1 / Math.max(1, latest.cpuCount) : 0;
  const memUsed = latest ? 1 - latest.memAvailable / latest.memTotal : 0;
  const swapUsed = latest && latest.swapTotal > 0 ? 1 - latest.swapFree / latest.swapTotal : 0;
  const diskUsed = latest ? 1 - latest.diskFree / latest.diskTotal : 0;

  return (
    <div className="space-y-5">
      {stale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {latest
            ? `No heartbeat from the render worker for ${ago(latest.createdAt)}. It may be down.`
            : "No heartbeats yet. The render worker sends one every 30 s once it's running."}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="CPU load"
          value={latest ? pct(loadPerCore) : "—"}
          tone={toneFor(loadPerCore)}
          sub={latest ? <>
            {latest.loadAvg1.toFixed(2)} / {latest.loadAvg5.toFixed(2)} / {latest.loadAvg15.toFixed(2)} on {latest.cpuCount} cores
            <Meter value={loadPerCore} />
          </> : undefined}
        />
        <Stat
          label="RAM"
          value={latest ? pct(memUsed) : "—"}
          tone={toneFor(memUsed)}
          sub={latest ? <>
            {gb(latest.memTotal - latest.memAvailable)} of {gb(latest.memTotal)}
            <Meter value={memUsed} />
          </> : undefined}
        />
        <Stat
          label="Swap"
          value={latest ? pct(swapUsed) : "—"}
          tone={swapUsed > 0.25 ? "warn" : "ok"}
          sub={latest ? <>
            {gb(latest.swapTotal - latest.swapFree)} of {gb(latest.swapTotal)}
            <Meter value={swapUsed} />
          </> : undefined}
        />
        <Stat
          label="Disk"
          value={latest ? pct(diskUsed) : "—"}
          tone={toneFor(diskUsed)}
          sub={latest ? <>
            {gb(latest.diskFree)} free of {gb(latest.diskTotal)}
            <Meter value={diskUsed} />
          </> : undefined}
        />
      </div>

      <Panel
        title="Server load"
        right={
          <div className="flex gap-1">
            {[1, 6, 24, 48].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`text-xs px-2 py-1 rounded ${hours === h ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-white"}`}
              >
                {h}h
              </button>
            ))}
          </div>
        }
      >
        {history ? <Lines points={history} /> : <Loader2 className="animate-spin text-neutral-500" />}
        {latest && (
          <div className="text-xs text-neutral-500 mt-2">
            Worker {latest.workerBusy ? "rendering" : "idle"} · last heartbeat {ago(latest.createdAt)}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Queued renders" value={renders.queued} tone={renders.queued > 5 ? "warn" : "ok"} />
        <Stat label="Rendering now" value={renders.rendering} />
        <Stat
          label="Avg render (7d)"
          value={duration(renders.avgSeconds)}
          sub={`p95 ${duration(renders.p95Seconds)} · ${renders.timedRenders} timed`}
        />
        <Stat
          label="Done / failed (7d)"
          value={`${renders.done7d} / ${renders.failed7d}`}
          tone={renders.failed7d > 0 ? "warn" : "ok"}
        />
      </div>

      <LoadTestPanel />

      <Panel title="Recent render failures (7d)">
        <Table
          head={["Error", "User", "Type", "When"]}
          empty="No failures."
          rows={renders.failures.map((f) => [
            <span key="e" className="text-red-300 break-all">{f.error ?? "unknown"}</span>,
            <span key="u" className="font-mono text-xs">{f.userId.slice(0, 12)}…</span>,
            f.loadTest ? "load test" : "user",
            ago(f.at),
          ])}
        />
      </Panel>
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
    .map((r, i) => ({ label: `#${i + 1}`, value: (r.finishedAt! - r.startedAt!) / 1000 }));

  return (
    <Panel title="Load test">
      <p className="text-sm text-neutral-400 mb-3">
        Queues copies of your latest B-roll plan. Copies are marked as tests and never appear in your
        project. Watch CPU, RAM and swap above while they run.
      </p>
      {status === undefined ? (
        <Loader2 className="animate-spin text-neutral-500" />
      ) : !status.source ? (
        <div className="text-sm text-amber-200">Make a B-roll plan in one of your projects first.</div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-neutral-500">
            Source plan: {status.source.scenes} scenes · updated {ago(status.source.updatedAt)}
          </div>
          <div className="flex flex-wrap gap-2">
            {[1, 3, 5, 10].map((n) => (
              <Button
                key={n}
                size="sm"
                disabled={busy}
                onClick={() => run(async () => `Queued ${await queue({ count: n })} test render(s).`)}
              >
                Queue {n}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || status.total === 0}
              onClick={() => run(async () => `Removed ${await clear({})} test render(s).`)}
            >
              Clear test renders
            </Button>
          </div>
          {message && <div className="text-sm text-neutral-300">{message}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>Queued <span className="text-white tabular-nums">{status.queued}</span></div>
            <div>Rendering <span className="text-white tabular-nums">{status.rendering}</span></div>
            <div>Done <span className="text-white tabular-nums">{status.done}</span></div>
            <div>Failed <span className="text-white tabular-nums">{status.failed}</span></div>
          </div>
          {durations.length > 0 && (
            <div>
              <div className="text-xs text-neutral-500 mb-1">Render time per test job (oldest → newest)</div>
              <Bars data={durations} format={(s) => duration(s)} height={80} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
