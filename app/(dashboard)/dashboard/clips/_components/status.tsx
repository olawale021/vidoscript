"use client";

const STEP_LABEL: Record<string, string> = {
  downloading: "Downloading from YouTube",
  extracting: "Extracting audio",
  transcribing: "Transcribing",
  finding: "Finding the best clips",
};

export function StatusLine({
  status,
  step,
  progress,
  error,
  clipCount,
}: {
  status: string;
  step: string | null | undefined;
  progress: number;
  error: string | null | undefined;
  clipCount?: number;
}) {
  if (status === "ready") {
    return <div className="text-xs text-emerald-300">{clipCount ?? 0} clips ready</div>;
  }
  if (status === "failed") {
    return <div className="text-xs text-red-300 truncate">Failed: {error ?? "unknown error"}</div>;
  }
  if (status === "confirm") {
    return <div className="text-xs text-amber-200">Waiting for you to approve the download</div>;
  }
  const label =
    status === "uploading"
      ? "Uploading…"
      : status === "checking"
        ? "Checking video length and size…"
        : status === "queued"
          ? "Waiting in queue…"
          : `${STEP_LABEL[step ?? ""] ?? "Processing"}…`;
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="h-1 w-32 rounded-full bg-neutral-800 overflow-hidden">
        <div className="h-full bg-sky-400 transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <span className="text-xs text-neutral-500">{label}</span>
    </div>
  );
}
