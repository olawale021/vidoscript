"use client";

import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Re-render every few seconds so "updated 12s ago" stays current.
function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const ago = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))}s` : `${Math.round(sec / 60)} min`);

const STEP_LABEL: Record<string, string> = {
  downloading: "Downloading from YouTube",
  extracting: "Extracting audio",
  transcribing: "Transcribing",
  finding: "Finding the best clips",
};

// The worker's steps, in order, as pipeline chips.
const PIPE: { key: string; label: string; now: string }[] = [
  { key: "downloading", label: "Download", now: "Downloading" },
  { key: "extracting", label: "Audio", now: "Extracting audio" },
  { key: "transcribing", label: "Transcribing", now: "Transcribing" },
  { key: "finding", label: "Find clips", now: "Finding clips" },
];

const busy = (status: string) => status === "uploading" || status === "checking" || status === "queued" || status === "processing";

// Download → Audio → Transcribing → Find clips, derived from status/step.
export function Pipeline({
  status,
  step,
  sourceType,
  className,
}: {
  status: string;
  step: string | null | undefined;
  sourceType?: string;
  className?: string;
}) {
  const upload = sourceType !== "url";
  let current = step ? PIPE.findIndex((p) => p.key === step) : -1;
  if (status === "uploading" || status === "checking") current = 0;
  if (status === "processing" && current < 0) current = upload ? 1 : 0;
  const steps = PIPE.map((p, i) =>
    i === 0 && upload ? { ...p, label: "Upload", now: status === "uploading" ? "Uploading" : "Upload" } : p
  );
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {steps.map((p, i) => {
        // An upload's first step is done once the file has arrived.
        const done = i < current || (i === 0 && upload && status !== "uploading");
        const now = i === current && !done;
        const queuedHere = now && status === "queued";
        return (
          <Fragment key={p.key}>
            {i > 0 && <i className="h-px w-2.5 bg-line-strong" aria-hidden />}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px]",
                now
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : done
                    ? "border-line text-muted"
                    : "border-line text-faint"
              )}
            >
              {done && <span className="text-ok">✓</span>}
              {now && !queuedHere ? <span className="shimmer">{p.now}</span> : p.label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

// "Part 3 of 4 · updated 12s ago" — the worker's live detail while it works.
export function LiveLine({
  status,
  step,
  detail,
  updatedAt,
  className,
}: {
  status: string;
  step?: string | null;
  detail?: string | null;
  updatedAt?: number | null;
  className?: string;
}) {
  const now = useNow();
  const label =
    status === "uploading"
      ? "Uploading…"
      : status === "checking"
        ? "Checking video length and size…"
        : status === "queued"
          ? "Waiting in queue…"
          : `${STEP_LABEL[step ?? ""] ?? "Processing"}…`;
  const working = status === "processing";
  const sinceSec = working && updatedAt ? (now - updatedAt) / 1000 : null;
  const quiet = sinceSec !== null && sinceSec > 4 * 60;
  const blocking = !!detail && /block/i.test(detail);
  return (
    <p className={cn("min-w-0 text-xs", quiet || blocking ? "text-accent" : "text-faint", className)}>
      <span className="break-words">{working && detail ? detail : label}</span>
      {sinceSec !== null && (
        <span className="whitespace-nowrap">
          {" · "}
          {quiet ? `no update for ${ago(sinceSec)}, it may be stuck` : `updated ${ago(sinceSec)} ago`}
        </span>
      )}
    </p>
  );
}

export function StatusLine({
  status,
  step,
  progress,
  error,
  clipCount,
  detail,
  updatedAt,
  sourceType,
}: {
  status: string;
  step: string | null | undefined;
  progress: number;
  error: string | null | undefined;
  clipCount?: number;
  detail?: string | null;
  updatedAt?: number | null;
  sourceType?: string;
}) {
  if (status === "ready") {
    return <div className="text-xs text-ok">{clipCount ?? 0} clips ready</div>;
  }
  if (status === "failed") {
    return <div className="truncate text-xs text-bad">Failed: {error ?? "unknown error"}</div>;
  }
  if (status === "confirm") {
    return (
      <div className="text-xs text-accent">
        {error ? `${error} Choose on the Clips page.` : "Waiting for you to approve the download"}
      </div>
    );
  }
  return (
    <div className="mt-1 grid min-w-0 gap-1.5" title={busy(status) ? `${Math.round(progress)}%` : undefined}>
      <Pipeline status={status} step={step} sourceType={sourceType} />
      <LiveLine status={status} step={step} detail={detail} updatedAt={updatedAt} />
    </div>
  );
}
