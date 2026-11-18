"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, Film, Loader2, RotateCcw, Upload, Youtube } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tone } from "@/components/ui/kit";
import { LiveLine, Pipeline } from "./_components/status";
import { ClipsTabs } from "./_components/clips-tabs";

const MAX_BYTES = 5 * 1024 ** 3; // R2 single-upload limit

// PUT straight to R2 with progress (fetch has no upload progress).
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection (or the bucket's CORS settings)"));
    xhr.send(file);
  });
}

// Download options for pasted links. Size is relative to 720p (measured ≈ 16 MB/min);
// the main downloader charges the same tiny per-minute price at any quality.
const QUALITIES = [
  { key: "360", label: "360p", sizeVs720: 0.31, note: "Smallest · blurry when cropped to 9:16" },
  { key: "480", label: "480p", sizeVs720: 0.56, note: "Fine for talking heads" },
  { key: "720", label: "720p", sizeVs720: 1, note: "Recommended" },
  { key: "1080", label: "1080p", sizeVs720: 1.9, note: "Sharpest — best for 9:16 crops" },
] as const;
const DOWNLOAD_PER_MIN = 0.000011; // johnvc, any quality (the backup downloader costs more)
// Backup downloader (marielise.dev): per minute by quality, plus $0.05/MB when
// its premium (residential) proxy is used (5 MB minimum). Keep in sync with
// render-worker/clip-download.mjs.
const BACKUP_PER_MIN: Record<string, number> = { "360": 0.01, "480": 0.015, "720": 0.02, "1080": 0.03 };
const PREMIUM_PER_MB = 0.05;
const RUN_CAP_USD = 2; // hard limit per download; a route that would cost more isn't offered
type Downloader = "main" | "backup" | "premium";
const usdText = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
type Quality = (typeof QUALITIES)[number]["key"];

const fmtSize = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`);

// 1:12:40 / 22:04
const fmtLen = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.round(sec % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
const fmtAgo = (ms: number) => {
  const sec = Math.max(0, (Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  const d = Math.round(sec / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
};
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));

// Video thumbnail (YouTube) or a neutral placeholder, with the length on top.
function Thumb({ url, durationSec, className }: { url: string | null; durationSec: number | null; className?: string }) {
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-lg border border-line bg-surface-2", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-faint">
          <Film size={20} />
        </div>
      )}
      {durationSec ? (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-px font-mono text-[10px] text-white tabular">
          {fmtLen(durationSec)}
        </span>
      ) : null}
    </div>
  );
}

export default function ClipsPage() {
  const sources = useQuery(api.clips.list);
  const defaults = useQuery(api.settings.get);
  const createUpload = useMutation(api.clips.createUpload);
  const markUploaded = useMutation(api.clips.markUploaded);
  const createFromUrl = useMutation(api.clips.createFromUrl);
  const confirmDownload = useMutation(api.clips.confirmDownload);
  const removeSource = useMutation(api.clips.remove);
  const retrySource = useMutation(api.clips.retry);
  const [quality, setQuality] = useState<Record<string, Quality>>({});
  const [route, setRoute] = useState<Record<string, Downloader>>({});
  // The route each card will actually use this render (a pick that's now over
  // the $2 limit, e.g. after raising the quality, falls back to the main one).
  const routeChoice: Record<string, Downloader> = {};
  const [link, setLink] = useState("");
  const [rights, setRights] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const submitLink = async () => {
    setError(null);
    setLinkBusy(true);
    try {
      await createFromUrl({ url: link, rightsConfirmed: rights });
      setLink("");
      setRights(false);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
    } finally {
      setLinkBusy(false);
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith("video/")) return setError("Please choose a video file.");
      if (file.size > MAX_BYTES) return setError("Videos up to 5 GB are supported.");
      setUpload({ name: file.name, pct: 0 });
      try {
        const { sourceId, url } = await createUpload({
          title: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        await putWithProgress(url, file, (pct) => setUpload({ name: file.name, pct }));
        await markUploaded({ sourceId });
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
      } finally {
        setUpload(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [createUpload, markUploaded]
  );

  const videos = sources ?? [];
  const totalClips = videos.reduce((n, s) => n + (s.clipCount ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">Clips</h1>
          <p className="mt-1 text-sm text-muted">
            Drop in a long video. AI reads the transcript and picks the moments worth posting.
          </p>
        </div>
      </div>
      <ClipsTabs />

      {/* Intake: upload | YouTube link */}
      <div className="grid overflow-hidden rounded-[18px] border border-line-strong bg-surface sm:grid-cols-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f && !upload) start(f);
          }}
          className={cn(
            "grid min-w-0 content-center justify-items-center gap-3 border-b border-line p-5 text-center transition sm:border-b-0 sm:border-r sm:p-[22px]",
            dragging ? "bg-accent-soft" : "bg-[repeating-linear-gradient(135deg,transparent_0_12px,rgba(255,255,255,.012)_12px_24px)]"
          )}
        >
          {upload ? (
            <div className="grid w-full max-w-sm gap-2">
              <div className="truncate text-sm text-fg">Uploading {upload.name}</div>
              <div className="h-[5px] overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${upload.pct}%` }} />
              </div>
              <div className="text-xs text-faint tabular">{upload.pct}% · keep this tab open until it finishes</div>
            </div>
          ) : (
            <>
              <span className={cn("grid h-11 w-11 place-items-center rounded-xl border text-muted", dragging ? "border-accent text-accent" : "border-line-strong")}>
                <Upload size={20} />
              </span>
              <b className="text-base font-semibold">Drop a video here</b>
              <span className="text-[13px] text-faint">MP4, MOV or WebM up to 5 GB · kept 30 days</span>
              <Button size="sm" onClick={() => inputRef.current?.click()}>
                Choose file
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && start(e.target.files[0])}
          />
        </div>

        <div className="grid min-w-0 content-start gap-3 p-5 sm:p-[22px]">
          <b className="text-base font-semibold">Or paste a YouTube link</b>
          <div className="flex h-10 items-center gap-2 rounded-[10px] border border-line-strong bg-bg pl-3 pr-1.5 focus-within:border-neutral-600">
            <Youtube size={16} className="flex-shrink-0 text-faint" />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && link.trim() && rights && !linkBusy && submitLink()}
              placeholder="youtube.com/watch?v=… or /shorts/…"
              aria-label="YouTube link"
              className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint sm:text-sm"
            />
            <Button size="sm" className="h-7" onClick={submitLink} disabled={linkBusy || !link.trim() || !rights}>
              {linkBusy ? <Loader2 size={14} className="animate-spin" /> : "Get clips"}
            </Button>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
              className="mt-[3px] h-4 w-4 flex-shrink-0 accent-[var(--color-fg)]"
            />
            <span>
              I own this video or have permission to use it. Clipping other people&apos;s videos without permission can
              break YouTube&apos;s terms and copyright law.
            </span>
          </label>
          <p className="text-xs text-faint">
            Public videos up to 3 hours. You see length, size and cost before anything downloads, usually under $0.01 per
            video. Kept for 30 days.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex gap-2 rounded-[10px] border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {videos
        .filter((s) => s.status === "confirm")
        .map((s) => {
          const minutes = Math.max(1, Math.ceil((s.durationSec ?? 0) / 60));
          // Qualities this video actually has (unknown → all allowed).
          const avail = s.availableQualities;
          const has = (k: string) => !avail || avail.length === 0 || avail.includes(k);
          const fallbackQ = [...QUALITIES].reverse().find((x) => x.key !== "1080" && has(x.key))?.key ?? "720";
          const preferred = s.downloadQuality ?? defaults?.defaultDownloadQuality ?? "720";
          const q = quality[s._id] ?? (has(preferred) ? preferred : has("720") ? "720" : fallbackQ);
          const opt = QUALITIES.find((x) => x.key === q)!;
          const mb720 = s.estimateMb ?? minutes * 16;
          const mbAtQ = Math.max(5, mb720 * opt.sizeVs720);
          const routeCost: Record<Downloader, number> = {
            main: minutes * DOWNLOAD_PER_MIN,
            backup: minutes * (BACKUP_PER_MIN[q] ?? 0.02),
            premium: minutes * (BACKUP_PER_MIN[q] ?? 0.02) + mbAtQ * PREMIUM_PER_MB,
          };
          const picked: Downloader = route[s._id] ?? "main";
          const r: Downloader = routeCost[picked] > RUN_CAP_USD ? "main" : picked;
          routeChoice[s._id] = r;
          const dl = s.blocked ? routeCost[r] : routeCost.main;
          const tr = Math.max(0.01, ((s.durationSec ?? 0) / 3600) * 0.04);
          return (
            <div
              key={s._id}
              className="grid items-center gap-4 rounded-[18px] border border-accent/35 bg-[linear-gradient(180deg,rgba(242,184,75,.06),transparent)] p-4 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:gap-5"
            >
              <Thumb url={s.thumbnailUrl} durationSec={s.durationSec} className="max-sm:max-w-[240px]" />
              <div className="min-w-0">
                {s.blocked ? <Tone tone="bad">Blocked by YouTube</Tone> : <Tone tone="warn">Approve download</Tone>}
                <h3 className="mt-2 truncate text-base font-semibold">{s.title}</h3>
                {s.channelName && <p className="text-[13px] text-faint">{s.channelName} · YouTube</p>}
                {s.error && (
                  <p className="mt-2 rounded-lg border border-accent/35 bg-accent-soft px-2.5 py-1.5 text-[13px] text-accent">{s.error}</p>
                )}
                <div className="my-2.5 flex flex-wrap gap-1.5">
                  {QUALITIES.map((x) => (
                    <button
                      key={x.key}
                      type="button"
                      aria-pressed={q === x.key}
                      disabled={!has(x.key)}
                      onClick={() => setQuality((prev) => ({ ...prev, [s._id]: x.key }))}
                      title={has(x.key) ? x.note : "Not available for this video"}
                      className={cn(
                        "grid min-w-[76px] gap-px rounded-[9px] border px-[11px] py-[7px] text-left transition disabled:cursor-not-allowed disabled:opacity-30",
                        q === x.key ? "border-fg bg-surface-3" : "border-line-strong hover:border-neutral-600"
                      )}
                    >
                      <b className="text-[13px] text-fg">{x.label}</b>
                      <small className="font-mono text-[11px] text-muted">{has(x.key) ? fmtSize(mb720 * x.sizeVs720) : "n/a"}</small>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                  <span>
                    Length <b className="text-fg tabular">{s.durationSec ? fmtLen(s.durationSec) : "?"}</b>
                  </span>
                  <span>
                    Size ≈ <b className="text-fg tabular">{fmtSize(mb720 * opt.sizeVs720)}</b>
                  </span>
                  <span>
                    Download <b className="text-fg tabular">{usdText(dl)}</b>
                  </span>
                  <span>
                    Transcription <b className="text-fg tabular">{usdText(tr)}</b>
                  </span>
                  <span>
                    Total <b className="text-fg tabular">≈ {usdText(dl + tr)}</b>
                  </span>
                </div>
                {s.blocked && (
                  <div className="mt-2.5 grid gap-1.5" role="radiogroup" aria-label="Downloader">
                    <div className="text-xs font-medium text-muted">How should we try next?</div>
                    {(
                      [
                        ["main", "Main downloader again", "Cheapest. Works once YouTube stops blocking, often within minutes."],
                        ["backup", "Backup downloader", "A different route that gets past some blocks."],
                        ["premium", "Backup + premium proxy", "Gets past almost every block. Priced by file size."],
                      ] as const
                    ).map(([key, label, hint]) => {
                      const cost = routeCost[key];
                      const overCap = cost > RUN_CAP_USD;
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={r === key}
                          disabled={overCap}
                          onClick={() => setRoute((prev) => ({ ...prev, [s._id]: key }))}
                          className={cn(
                            "flex items-start justify-between gap-3 rounded-[9px] border px-[11px] py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
                            r === key && !overCap ? "border-fg bg-surface-3" : "border-line-strong hover:border-neutral-600"
                          )}
                        >
                          <span className="min-w-0">
                            <b className="block text-[13px] font-semibold text-fg">{label}</b>
                            <small className="block text-xs text-faint">{hint}</small>
                          </span>
                          <span className="whitespace-nowrap text-right font-mono text-xs text-fg">
                            ≈ {usdText(cost)}
                            {overCap && <small className="block font-sans text-[10px] text-faint">over the $2 limit</small>}
                          </span>
                        </button>
                      );
                    })}
                    {q !== "480" && q !== "360" && has("480") && (
                      <p className="text-xs text-faint">
                        Each download is limited to $2.{" "}
                        <button
                          type="button"
                          onClick={() => {
                            setQuality((prev) => ({ ...prev, [s._id]: "480" }));
                            setRoute((prev) => ({ ...prev, [s._id]: "backup" }));
                          }}
                          className="text-fg underline underline-offset-2"
                        >
                          Or take 480p with the backup downloader (≈ {usdText(minutes * BACKUP_PER_MIN["480"])})
                        </button>
                      </p>
                    )}
                  </div>
                )}
                <p className="mt-2 text-xs text-faint">
                  {opt.note}. You get exactly this quality: if YouTube blocks it, we ask you before trying anything else.
                  Each download is limited to $2; anything that would cost more stops instead.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
                <Button
                  onClick={() =>
                    confirmDownload({
                      sourceId: s._id,
                      quality: (quality[s._id] ?? s.downloadQuality ?? defaults?.defaultDownloadQuality ?? "720") as Quality,
                      downloader: s.blocked ? (routeChoice[s._id] ?? "main") : "auto",
                    })
                  }
                >
                  {s.error ? "Try again" : `Download ${opt.label}`}
                </Button>
                <Button variant="ghost" onClick={() => removeSource({ sourceId: s._id })}>
                  Cancel
                </Button>
              </div>
            </div>
          );
        })}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Your videos</h2>
          {videos.length > 0 && (
            <span className="text-xs text-faint tabular">
              {videos.length} video{videos.length === 1 ? "" : "s"} · {totalClips} clip{totalClips === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {sources === undefined ? (
          <Loader2 className="animate-spin text-faint" />
        ) : videos.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-faint">
            No videos yet. Upload one or paste a link above.
          </div>
        ) : (
          <div className="grid gap-2.5">
            {videos.map((s) => {
              const ready = s.status === "ready";
              const failed = s.status === "failed";
              return (
                <div
                  key={s._id}
                  className="relative grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 rounded-[12px] border border-line bg-surface p-2.5 transition hover:border-line-strong sm:grid-cols-[148px_minmax(0,1fr)_auto] sm:gap-4"
                >
                  <Thumb url={s.thumbnailUrl} durationSec={s.durationSec} />
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-semibold tracking-tight">
                      {/* The whole row is the link; Retry sits above it. */}
                      <Link href={`/dashboard/clips/${s._id}`} className="after:absolute after:inset-0 after:rounded-[12px]">
                        {s.title}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-xs text-faint tabular">
                      {s.durationSec ? `${fmtLen(s.durationSec)} · ` : ""}
                      {s.sourceType === "url" ? "added" : "uploaded"} {fmtAgo(s.createdAt)}
                    </p>
                    {ready ? (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        <Tone tone="ok">
                          {s.clipCount} clip{s.clipCount === 1 ? "" : "s"} ready
                        </Tone>
                        {s.unratedCount > 0 && <Tone tone="warn">{s.unratedCount} unrated</Tone>}
                        {s.exportedCount > 0 && (
                          <span className="inline-flex items-center rounded-full border border-line px-2 py-px text-[11px] text-muted">
                            {s.exportedCount} exported
                          </span>
                        )}
                      </div>
                    ) : failed ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Tone tone="bad">Failed</Tone>
                        <span className="min-w-0 truncate text-xs text-bad">{s.error ?? "unknown error"}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="relative z-10"
                          onClick={() => retrySource({ sourceId: s._id }).catch((e) => setError(errText(e)))}
                        >
                          <RotateCcw size={14} className="mr-1" /> Retry
                        </Button>
                      </div>
                    ) : s.status === "confirm" ? (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        <Tone tone={s.blocked ? "bad" : "warn"}>{s.blocked ? "Blocked, choose a downloader above" : "Approve the download above"}</Tone>
                      </div>
                    ) : (
                      <>
                        <Pipeline status={s.status} step={s.step} sourceType={s.sourceType} className="mt-2.5" />
                        <LiveLine status={s.status} step={s.step} detail={s.stepDetail} updatedAt={s.updatedAt} className="mt-1.5" />
                      </>
                    )}
                  </div>
                  <div className="hidden justify-items-end gap-0.5 text-right sm:grid">
                    <span className="text-[22px] font-semibold tabular">{ready ? s.clipCount : "—"}</span>
                    <span className="text-xs text-faint">clips</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
