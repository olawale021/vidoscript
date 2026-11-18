"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, Loader2, Pencil, Play, Repeat2, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SaveVideoButton } from "@/components/save-video-button";
import { cn } from "@/lib/utils";
import { Chip, Ring } from "@/components/ui/kit";
import { StatusLine } from "../_components/status";

// Preset reasons for Replace (the creator can also type their own).
const REPLACE_REASONS = ["Boring", "No context", "Bad start", "Cuts off", "Too long", "Too short", "Off-topic", "Already used", "Not funny", "Weak hook"];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtLen = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.round(sec % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

type Filter = "all" | "unrated" | "liked" | "exported";

export default function ClipSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sourceId = id as Id<"clipSources">;
  const router = useRouter();
  const source = useQuery(api.clips.get, { sourceId });
  const retry = useMutation(api.clips.retry);
  const remove = useMutation(api.clips.remove);
  const rate = useMutation(api.clips.rate);
  const findMore = useMutation(api.clips.findMore);
  const replaceClip = useMutation(api.clips.replace);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [replaceReasons, setReplaceReasons] = useState<string[]>([]);
  const [replaceNote, setReplaceNote] = useState("");
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [needRating, setNeedRating] = useState(false);
  const openReplace = (id: string | null) => {
    setReplaceFor(id);
    setReplaceReasons([]);
    setReplaceNote("");
    setReplaceError(null);
  };
  const [reasonsFor, setReasonsFor] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState<{ id: string; end: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [videoDur, setVideoDur] = useState<number | null>(null);

  // Stop playback at the end of the selected clip.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return;
    const onTime = () => {
      if (v.currentTime >= active.end) {
        v.pause();
        setActive(null);
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [active]);

  if (source === undefined) return <Loader2 className="animate-spin text-faint" />;
  if (source === null) {
    return (
      <div className="text-muted">
        Video not found.{" "}
        <Link href="/dashboard/clips" className="underline">
          Back to clips
        </Link>
      </div>
    );
  }

  const live = source.clips.filter((c) => !c.replacing);
  const unratedCount = live.filter((c) => !c.rating).length;
  const counts: Record<Filter, number> = {
    all: source.clips.length,
    unrated: unratedCount,
    liked: live.filter((c) => c.rating === 1).length,
    exported: live.filter((c) => c.renderStatus === "done").length,
  };
  const shown = source.clips
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) =>
      filter === "all"
        ? true
        : c.replacing
          ? false
          : filter === "unrated"
            ? !c.rating
            : filter === "liked"
              ? c.rating === 1
              : c.renderStatus === "done"
    );
  const duration = source.durationSec || videoDur || Math.max(1, ...source.clips.map((c) => c.end));
  const selIndex = source.clips.findIndex((c) => c._id === (selected ?? active?.id ?? live[0]?._id));
  const sel = selIndex >= 0 ? source.clips[selIndex] : null;
  const working = source.status === "queued" || source.status === "processing";

  const reveal = (id: string) =>
    document.getElementById(`clip-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const seek = (clip: { _id: string; start: number }) => {
    setSelected(clip._id);
    const v = videoRef.current;
    if (v) v.currentTime = clip.start;
  };
  const play = (clip: { _id: string; start: number; end: number }) => {
    setSelected(clip._id);
    reveal(clip._id);
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clip.start;
    setActive({ id: clip._id, end: clip.end });
    v.play().catch(() => {});
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 lg:flex lg:h-full lg:flex-col">
      <div className="space-y-2">
        <Link href="/dashboard/clips" className="inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-fg">
          <ArrowLeft size={14} /> Clips
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-[26px] [overflow-wrap:anywhere]">{source.title}</h1>
            <p className="mt-1 font-mono text-[13px] text-faint tabular">
              {source.durationSec ? `${fmtLen(source.durationSec)} · ` : ""}
              {live.length} clip{live.length === 1 ? "" : "s"}
              {source.status === "ready" ? " · transcript reused for new picks, no extra cost" : ""}
            </p>
            {source.status !== "ready" && (
              <StatusLine
                status={source.status}
                step={source.step}
                progress={source.progress}
                error={source.error}
                clipCount={source.clips.length}
                detail={source.stepDetail}
                updatedAt={source.updatedAt}
                sourceType={source.sourceType}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {source.status === "failed" && (
              <Button size="sm" variant="outline" onClick={() => retry({ sourceId })}>
                <RotateCcw size={14} className="mr-1" /> Retry
              </Button>
            )}
            {source.status !== "processing" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm("Delete this video and its clips?")) return;
                  await remove({ sourceId });
                  router.push("/dashboard/clips");
                }}
              >
                <Trash2 size={14} className="mr-1" /> Delete
              </Button>
            )}
            {source.status === "ready" ? (
              <Button
                size="sm"
                onClick={() => {
                  if (unratedCount > 0) {
                    setNeedRating(true);
                    setFilter("unrated");
                    return;
                  }
                  setNeedRating(false);
                  findMore({ sourceId }).catch(() => setNeedRating(true));
                }}
                title="Reuses the transcript, no new transcription cost"
              >
                <Sparkles size={14} className="mr-1" /> Find more clips
              </Button>
            ) : working && source.clips.length > 0 ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 text-[13px] text-accent">
                <Loader2 size={13} className="animate-spin" /> <span className="shimmer">Finding more…</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[minmax(0,1fr)]">
        {/* Desktop: the page fits the screen; only the clip list scrolls, so no dead space under the video. */}
        <div className="grid min-w-0 gap-3 lg:max-h-full lg:overflow-y-auto">
          <div className="overflow-hidden rounded-[12px] border border-line bg-black">
            {source.videoUrl ? (
              <video
                ref={videoRef}
                src={source.videoUrl}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => setVideoDur(e.currentTarget.duration || null)}
                className="aspect-video max-h-[70vh] w-full bg-black lg:max-h-[calc(100dvh-19rem)]"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-faint">
                Video will appear once the upload finishes.
              </div>
            )}
          </div>

          {live.length > 0 && (
            <div className="grid gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-faint">
                <span>Where the clips are in the video</span>
                {sel && !sel.replacing && (
                  <span className="text-muted tabular">
                    Clip {selIndex + 1} · {fmt(sel.start)}–{fmt(sel.end)}
                  </span>
                )}
              </div>
              <div className="relative h-[34px] rounded-md border border-line bg-[repeating-linear-gradient(90deg,var(--color-surface-2)_0_2px,transparent_2px_6px)]">
                {source.clips.map((c, i) =>
                  c.replacing ? null : (
                    <button
                      key={c._id}
                      type="button"
                      title={`${i + 1}. ${c.title} (${fmt(c.start)}–${fmt(c.end)})`}
                      aria-label={`Play clip ${i + 1}`}
                      onClick={() => play(c)}
                      disabled={!source.videoUrl}
                      className={cn(
                        "absolute bottom-[3px] top-[3px] grid min-w-[14px] place-items-center overflow-hidden rounded border font-mono text-[10px] transition",
                        sel?._id === c._id
                          ? "z-10 border-fg bg-fg text-bg"
                          : "border-line-strong bg-surface-3 text-muted hover:bg-neutral-700"
                      )}
                      style={{
                        left: `${Math.min(98, (c.start / duration) * 100)}%`,
                        width: `${Math.max(2.2, ((c.end - c.start) / duration) * 100)}%`,
                      }}
                    >
                      {i + 1}
                    </button>
                  )
                )}
              </div>
              <div className="flex justify-between font-mono text-[10px] text-faint tabular">
                {[0, 0.25, 0.5, 0.75, 1].map((k) => (
                  <span key={k} className={k === 0.25 || k === 0.75 ? "max-sm:hidden" : undefined}>
                    {fmtLen(duration * k)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <section className="min-w-0 lg:self-stretch lg:overflow-y-auto lg:overscroll-contain lg:pb-4 lg:pr-1.5">
          <div className="sticky top-0 z-20 -mt-1 grid gap-2.5 bg-bg pb-2.5 pt-1">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter clips">
              {(
                [
                  ["all", "All"],
                  ["unrated", "Unrated"],
                  ["liked", "Liked"],
                  ["exported", "Exported"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition",
                    filter === key ? "border-fg bg-surface-3 text-fg" : "border-line-strong text-muted hover:text-fg"
                  )}
                >
                  {label}
                  <span className={cn("tabular", key === "unrated" && counts.unrated > 0 ? "text-accent" : "text-faint")}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>
            {needRating && unratedCount > 0 && (
              <div className="rounded-lg border border-accent/35 bg-accent-soft px-3 py-2 text-[13px] text-accent">
                Rate the {unratedCount} unrated clip{unratedCount > 1 ? "s" : ""} first (👍 or 👎, reasons optional). Your
                ratings teach the AI what to pick next.
              </div>
            )}
            {source.status === "ready" && source.error && <p className="text-xs text-accent">{source.error}</p>}
          </div>

          {source.clips.some((c) => c.rating) && (
            <p className="mb-2.5 text-xs text-faint">Your 👍 / 👎 teach the AI what you like. It uses them every time it picks clips.</p>
          )}

          {source.status !== "ready" && source.clips.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-faint">
              {source.status === "failed" ? "No clips, processing failed." : "Clips will appear here when processing finishes."}
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-faint">
              No {filter} clips.
            </div>
          ) : (
            <ul className="grid gap-2.5">
              {shown.map(({ c, n }) =>
                c.replacing ? (
                  <li key={c._id} className="rounded-[12px] border border-dashed border-line-strong bg-surface p-3.5">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-surface-3">
                        <Loader2 size={16} className="animate-spin text-accent" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="shimmer text-[15px] font-semibold">Finding a different moment…</h3>
                        <p className="truncate text-xs text-faint">
                          Replacing “{c.title}”{c.ratingReasons?.length ? ` · ${c.ratingReasons.join(", ")}` : ""}
                        </p>
                      </div>
                    </div>
                  </li>
                ) : (
                  <li
                    key={c._id}
                    id={`clip-${c._id}`}
                    onClick={() => seek(c)}
                    className={cn(
                      "grid cursor-pointer gap-2.5 rounded-[12px] border bg-surface p-3.5 transition",
                      sel?._id === c._id ? "border-fg" : "border-line hover:border-line-strong",
                      !c.rating && "shadow-[inset_3px_0_0_var(--color-accent)]",
                      needRating && !c.rating && sel?._id !== c._id && "border-accent/60"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Ring value={c.score} title="AI score: how likely the clip is to perform" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-semibold tracking-tight">
                          {n}. {c.title}
                          {c.replacesClipId && (
                            <span className="ml-2 rounded-full bg-accent-soft px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-accent">
                              New
                            </span>
                          )}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs text-faint tabular">
                          {fmt(c.start)}–{fmt(c.end)} · {Math.round(c.end - c.start)}s
                        </p>
                      </div>
                    </div>
                    {c.hook && <p className="text-sm leading-relaxed text-fg">“{c.hook}”</p>}
                    {c.reason && <p className="text-[13px] text-faint">{c.reason}</p>}
                    <details onClick={(e) => e.stopPropagation()}>
                      <summary className="cursor-pointer text-xs text-faint hover:text-muted">Transcript</summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{c.text}</p>
                    </details>

                    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        title="Good clip"
                        aria-label="Good clip"
                        aria-pressed={c.rating === 1}
                        onClick={() => {
                          rate({ clipId: c._id, rating: c.rating === 1 ? 0 : 1 });
                          setReasonsFor(c.rating === 1 ? null : c._id);
                        }}
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg border transition",
                          c.rating === 1 ? "border-ok/40 bg-ok/10 text-ok" : "border-line text-faint hover:border-line-strong hover:text-fg"
                        )}
                      >
                        <ThumbsUp size={15} />
                      </button>
                      <button
                        type="button"
                        title="Bad clip"
                        aria-label="Bad clip"
                        aria-pressed={c.rating === -1}
                        onClick={() => {
                          rate({ clipId: c._id, rating: c.rating === -1 ? 0 : -1 });
                          setReasonsFor(c.rating === -1 ? null : c._id);
                        }}
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg border transition",
                          c.rating === -1 ? "border-bad/40 bg-bad/10 text-bad" : "border-line text-faint hover:border-line-strong hover:text-fg"
                        )}
                      >
                        <ThumbsDown size={15} />
                      </button>
                      <button
                        type="button"
                        title="Preview this clip"
                        aria-label="Preview this clip"
                        disabled={!source.videoUrl}
                        onClick={() => play(c)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-faint transition hover:border-line-strong hover:text-fg disabled:opacity-40"
                      >
                        <Play size={14} />
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openReplace(replaceFor === c._id ? null : c._id)}
                        title="The AI finds a different moment from this video"
                      >
                        <Repeat2 size={14} className="mr-1" /> Replace
                      </Button>
                      <Link href={`/dashboard/clips/${sourceId}/edit/${c._id}`}>
                        <Button size="sm">
                          <Pencil size={14} className="mr-1" /> Edit &amp; export
                        </Button>
                      </Link>
                      <span className="ml-auto inline-flex items-center">
                        {c.renderStatus === "done" && c.downloadUrl ? (
                          <SaveVideoButton
                            downloadUrl={c.downloadUrl}
                            fileName={`${c.title || "clip"}.mp4`}
                            label={`MP4${c.renderedAspect ? ` · ${c.renderedAspect}` : ""}`}
                          />
                        ) : c.renderStatus === "queued" || c.renderStatus === "rendering" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-accent">
                            <Loader2 size={12} className="animate-spin" />
                            {c.renderStatus === "queued" ? "Export queued" : `Exporting ${c.renderProgress ?? 0}%`}
                          </span>
                        ) : c.renderStatus === "failed" ? (
                          <span className="text-xs text-bad">Export failed</span>
                        ) : null}
                      </span>
                    </div>

                    {reasonsFor === c._id && c.rating ? (
                      <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {(c.rating === 1
                          ? ["Great hook", "Funny", "Strong opinion", "Good length", "Clear story", "Valuable info"]
                          : ["Boring", "No context", "Bad start", "Cuts off", "Too long", "Too short", "Off-topic"]
                        ).map((r) => {
                          const on = (c.ratingReasons ?? []).includes(r);
                          return (
                            <Chip
                              key={r}
                              pressed={on}
                              onClick={() =>
                                rate({
                                  clipId: c._id,
                                  rating: c.rating!,
                                  reasons: on ? (c.ratingReasons ?? []).filter((x) => x !== r) : [...(c.ratingReasons ?? []), r],
                                })
                              }
                            >
                              {r}
                            </Chip>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setReasonsFor(null)}
                          className="inline-flex h-7 items-center gap-1 px-1.5 text-xs text-faint hover:text-fg"
                        >
                          <Check size={12} /> Done
                        </button>
                      </div>
                    ) : c.ratingReasons && c.ratingReasons.length > 0 ? (
                      <p className="text-xs text-faint">{c.ratingReasons.join(", ")}</p>
                    ) : null}

                    {replaceFor === c._id && (
                      <div className="grid gap-2.5 border-t border-dashed border-line-strong pt-3" onClick={(e) => e.stopPropagation()}>
                        <b className="text-sm font-semibold">What&apos;s wrong with this clip?</b>
                        <div className="flex flex-wrap gap-1.5">
                          {REPLACE_REASONS.map((r) => {
                            const on = replaceReasons.includes(r);
                            return (
                              <Chip
                                key={r}
                                pressed={on}
                                onClick={() => setReplaceReasons(on ? replaceReasons.filter((x) => x !== r) : [...replaceReasons, r])}
                              >
                                {r}
                              </Chip>
                            );
                          })}
                        </div>
                        <textarea
                          aria-label="Your own reason"
                          value={replaceNote}
                          onChange={(e) => setReplaceNote(e.target.value)}
                          rows={2}
                          placeholder="Or say it in your own words (optional). The AI learns from this."
                          className="min-h-[60px] w-full resize-y rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 text-base text-fg outline-none placeholder:text-faint focus:border-neutral-600 sm:text-sm"
                        />
                        {replaceError && <p className="text-xs text-bad">{replaceError}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={replaceReasons.length === 0 && !replaceNote.trim()}
                            onClick={async () => {
                              try {
                                await replaceClip({ clipId: c._id, reasons: replaceReasons, note: replaceNote });
                                openReplace(null);
                              } catch (e) {
                                setReplaceError(
                                  e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e)
                                );
                              }
                            }}
                          >
                            <Repeat2 size={14} className="mr-1" /> Replace clip
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openReplace(null)}>
                            Cancel
                          </Button>
                          <span className="text-xs text-faint">No new transcription cost</span>
                        </div>
                      </div>
                    )}
                  </li>
                )
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
