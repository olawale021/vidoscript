"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Download, Loader2, Pencil, Play, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SaveVideoButton } from "@/components/save-video-button";
import { cn } from "@/lib/utils";
import { StatusLine } from "../_components/status";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function ClipSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sourceId = id as Id<"clipSources">;
  const router = useRouter();
  const source = useQuery(api.clips.get, { sourceId });
  const retry = useMutation(api.clips.retry);
  const remove = useMutation(api.clips.remove);
  const rate = useMutation(api.clips.rate);
  const findMore = useMutation(api.clips.findMore);
  const [reasonsFor, setReasonsFor] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState<{ id: string; end: number } | null>(null);

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

  if (source === undefined) return <Loader2 className="animate-spin text-neutral-500" />;
  if (source === null) {
    return (
      <div className="text-neutral-400">
        Video not found. <Link href="/dashboard/clips" className="underline">Back to clips</Link>
      </div>
    );
  }

  const play = (clip: { _id: string; start: number; end: number }) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = clip.start;
    setActive({ id: clip._id, end: clip.end });
    v.play().catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard/clips" className="text-sm text-neutral-500 hover:text-white inline-flex items-center gap-1">
            <ArrowLeft size={14} /> Clips
          </Link>
          <h1 className="text-xl font-semibold text-white mt-2 truncate">{source.title}</h1>
          <StatusLine
            status={source.status}
            step={source.step}
            progress={source.progress}
            error={source.error}
            clipCount={source.clips.length}
          />
          {source.durationSec ? (
            <div className="text-xs text-neutral-500 mt-1">{fmt(source.durationSec)} long</div>
          ) : null}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {source.status === "failed" && (
            <Button size="sm" variant="outline" onClick={() => retry({ sourceId })}>
              <RotateCcw size={14} className="mr-1" /> Retry
            </Button>
          )}
          {source.status !== "processing" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!confirm("Delete this video and its clips?")) return;
                await remove({ sourceId });
                router.push("/dashboard/clips");
              }}
            >
              <Trash2 size={14} className="mr-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
        {/* Video stays in view while the clip list scrolls beside it. */}
        <div className="lg:sticky lg:top-0 rounded-lg overflow-hidden border border-neutral-800 bg-neutral-950">
          {source.videoUrl ? (
            <video ref={videoRef} src={source.videoUrl} controls preload="metadata" className="w-full max-h-[70vh] bg-black" />
          ) : (
            <div className="aspect-video flex items-center justify-center text-neutral-500 text-sm">
              Video will appear once the upload finishes.
            </div>
          )}
        </div>

        <section className="space-y-2 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pr-1">
          <div className="flex items-center justify-between gap-2 lg:sticky lg:top-0 bg-black pb-1 z-10">
            <h2 className="text-sm font-semibold text-neutral-300">
              Suggested clips {source.clips.length > 0 && <span className="text-neutral-500">({source.clips.length})</span>}
            </h2>
            {source.status === "ready" ? (
              <Button size="sm" variant="outline" onClick={() => findMore({ sourceId })} title="Reuses the transcript — no new transcription cost">
                <Sparkles size={14} className="mr-1" /> Find more clips
              </Button>
            ) : source.status === "queued" || source.status === "processing" ? (
              source.clips.length > 0 ? (
                <span className="text-xs text-amber-200 inline-flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" /> Finding more…
                </span>
              ) : null
            ) : null}
          </div>
          {source.status === "ready" && source.error && (
            <p className="text-xs text-amber-200">{source.error}</p>
          )}
          {source.clips.some((c) => c.rating) && (
            <p className="text-xs text-neutral-500">
              Your 👍 / 👎 teach the AI what you like — it uses them every time it picks clips.
            </p>
          )}
          {source.status !== "ready" && source.clips.length === 0 ? (
            <div className="text-sm text-neutral-500">
              {source.status === "failed" ? "No clips — processing failed." : "Clips will appear here when processing finishes."}
            </div>
          ) : (
            <ul className="space-y-2">
              {source.clips.map((c) => (
                <li
                  key={c._id}
                  className={cn(
                    "rounded-lg border bg-neutral-950 p-3 transition",
                    active?.id === c._id ? "border-sky-400" : "border-neutral-800"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-neutral-100 font-medium">{c.title}</div>
                      <div className="text-xs text-neutral-500">
                        {fmt(c.start)}–{fmt(c.end)} · {Math.round(c.end - c.start)}s
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0",
                        c.score >= 80 ? "bg-emerald-500/15 text-emerald-300" : c.score >= 60 ? "bg-amber-500/15 text-amber-200" : "bg-neutral-800 text-neutral-400"
                      )}
                      title="AI score: how likely the clip is to perform"
                    >
                      {c.score}
                    </span>
                  </div>
                  {c.hook && <p className="text-sm text-neutral-300 mt-2">“{c.hook}”</p>}
                  {c.reason && <p className="text-xs text-neutral-500 mt-1">{c.reason}</p>}
                  <details className="mt-2">
                    <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">Transcript</summary>
                    <p className="text-xs text-neutral-400 mt-1 whitespace-pre-wrap">{c.text}</p>
                  </details>
                  <div className="flex items-center gap-1 mt-2">
                    <button
                      title="Good clip"
                      onClick={() => {
                        rate({ clipId: c._id, rating: c.rating === 1 ? 0 : 1 });
                        setReasonsFor(c.rating === 1 ? null : c._id);
                      }}
                      className={cn(
                        "p-1.5 rounded-md transition",
                        c.rating === 1 ? "bg-emerald-500/20 text-emerald-300" : "text-neutral-500 hover:text-white hover:bg-neutral-800"
                      )}
                    >
                      <ThumbsUp size={15} />
                    </button>
                    <button
                      title="Bad clip"
                      onClick={() => {
                        rate({ clipId: c._id, rating: c.rating === -1 ? 0 : -1 });
                        setReasonsFor(c.rating === -1 ? null : c._id);
                      }}
                      className={cn(
                        "p-1.5 rounded-md transition",
                        c.rating === -1 ? "bg-red-500/20 text-red-300" : "text-neutral-500 hover:text-white hover:bg-neutral-800"
                      )}
                    >
                      <ThumbsDown size={15} />
                    </button>
                    {c.ratingReasons && c.ratingReasons.length > 0 && (
                      <span className="text-xs text-neutral-500 truncate">{c.ratingReasons.join(", ")}</span>
                    )}
                  </div>
                  {reasonsFor === c._id && c.rating && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(c.rating === 1
                        ? ["Great hook", "Funny", "Strong opinion", "Good length", "Clear story", "Valuable info"]
                        : ["Boring", "No context", "Bad start", "Cuts off", "Too long", "Too short", "Off-topic"]
                      ).map((r) => {
                        const on = (c.ratingReasons ?? []).includes(r);
                        return (
                          <button
                            key={r}
                            onClick={() =>
                              rate({
                                clipId: c._id,
                                rating: c.rating!,
                                reasons: on ? (c.ratingReasons ?? []).filter((x) => x !== r) : [...(c.ratingReasons ?? []), r],
                              })
                            }
                            className={cn(
                              "text-xs px-2 py-0.5 rounded-full border transition",
                              on ? "border-sky-400 text-sky-300 bg-sky-400/10" : "border-neutral-700 text-neutral-400 hover:text-white"
                            )}
                          >
                            {r}
                          </button>
                        );
                      })}
                      <button onClick={() => setReasonsFor(null)} className="text-xs text-neutral-500 hover:text-white px-1">
                        Done
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Button size="sm" variant="outline" onClick={() => play(c)} disabled={!source.videoUrl}>
                      <Play size={14} className="mr-1" /> Preview
                    </Button>
                    <Link href={`/dashboard/clips/${sourceId}/edit/${c._id}`}>
                      <Button size="sm">
                        <Pencil size={14} className="mr-1" /> Edit & export
                      </Button>
                    </Link>
                    {c.renderStatus === "done" && c.downloadUrl ? (
                      <SaveVideoButton
                        downloadUrl={c.downloadUrl}
                        fileName={`${c.title || "clip"}.mp4`}
                        label={`MP4${c.renderedAspect ? ` · ${c.renderedAspect}` : ""}`}
                      />
                    ) : c.renderStatus === "queued" || c.renderStatus === "rendering" ? (
                      <span className="text-xs text-amber-200 inline-flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        {c.renderStatus === "queued" ? "Export queued" : `Exporting ${c.renderProgress ?? 0}%`}
                      </span>
                    ) : c.renderStatus === "failed" ? (
                      <span className="text-xs text-red-300">Export failed</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
