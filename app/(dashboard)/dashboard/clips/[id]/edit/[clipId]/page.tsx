"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player } from "@remotion/player";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Download, Loader2, RotateCcw, Scissors } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClipComposition, clipDurationInFrames } from "@/remotion/Clip";
import {
  CLIP_DEFAULTS,
  CLIP_DIMS,
  CLIP_FPS,
  type CaptionPosition,
  type CaptionStyle,
  type ClipAspect,
  type ClipCompositionProps,
  type SmartEdit,
} from "@/types/clip";
import { SmartPanel, SmartTimeline } from "./_components/smart-panel";

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

const ASPECTS: { key: ClipAspect; label: string }[] = [
  { key: "9:16", label: "9:16 Reels / TikTok" },
  { key: "1:1", label: "1:1 Square" },
  { key: "16:9", label: "16:9 YouTube" },
];
const STYLES: { key: CaptionStyle; label: string }[] = [
  { key: "bold", label: "Bold" },
  { key: "karaoke", label: "Karaoke" },
  { key: "clean", label: "Clean" },
  { key: "none", label: "No captions" },
];
const POSITIONS: CaptionPosition[] = ["top", "middle", "bottom"];

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-neutral-800 p-1 bg-neutral-950">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "px-2.5 py-1 rounded-md text-xs font-medium transition",
            value === o.key ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId: rawClipId } = use(params);
  const clipId = rawClipId as Id<"clips">;
  const data = useQuery(api.clipEditor.editorData, { clipId });
  const update = useMutation(api.clipEditor.update);
  const setCaptionText = useMutation(api.clipEditor.setCaptionText);
  const resetCaptions = useMutation(api.clipEditor.resetCaptions);
  const exportClip = useMutation(api.clipEditor.exportClip);
  const saveSmart = useMutation(api.smartEdit.save);
  const regenerateSmart = useMutation(api.smartEdit.regenerate);

  // Local copy of the smart edits; re-seeded whenever the server copy changes
  // from elsewhere (e.g. a regenerate finishing).
  const [smart, setSmart] = useState<SmartEdit | null>(null);
  const serverSmart = (data?.clip.smart ?? null) as SmartEdit | null;
  const serverSmartKey = JSON.stringify(serverSmart);
  const lastSaved = useRef<string | null>(null);
  useEffect(() => {
    if (serverSmartKey !== lastSaved.current) {
      setSmart(serverSmart);
      lastSaved.current = serverSmartKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSmartKey]);
  useEffect(() => {
    if (!smart) return;
    const key = JSON.stringify(smart);
    if (key === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = key;
      saveSmart({ clipId, smart }).catch((e) =>
        setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e))
      );
    }, 500);
    return () => clearTimeout(t);
  }, [smart, clipId, saveSmart]);

  // Local editable state, seeded once from the server.
  const [s, setS] = useState<{
    title: string;
    start: number;
    end: number;
    aspect: ClipAspect;
    captionStyle: CaptionStyle;
    captionPosition: CaptionPosition;
    cropX: number;
  } | null>(null);
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !s) {
      const c = data.clip;
      setS({
        title: c.title,
        start: c.start,
        end: c.end,
        aspect: c.aspect ?? CLIP_DEFAULTS.aspect,
        captionStyle: c.captionStyle ?? CLIP_DEFAULTS.captionStyle,
        captionPosition: c.captionPosition ?? CLIP_DEFAULTS.captionPosition,
        cropX: c.cropX ?? CLIP_DEFAULTS.cropX,
      });
    }
  }, [data, s]);

  // Debounced autosave of settings.
  const firstSave = useRef(true);
  useEffect(() => {
    if (!s) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaving(true);
    const t = setTimeout(() => {
      update({ clipId, ...s })
        .then(() => setError(null))
        .catch((e) => setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e)))
        .finally(() => setSaving(false));
    }, 600);
    return () => clearTimeout(t);
  }, [s, clipId, update]);

  const wordsInClip = useMemo(() => {
    if (!data || !s) return [];
    return data.words.filter((w) => w.e > s.start && w.s < s.end);
  }, [data, s]);

  const captionText = useMemo(() => wordsInClip.map((w) => w.w).join(" "), [wordsInClip]);

  const inputProps: ClipCompositionProps | null = useMemo(() => {
    if (!data || !s) return null;
    return {
      videoUrl: data.videoUrl,
      videoOffsetSec: 0, // previewing the full source
      start: s.start,
      end: s.end,
      aspect: s.aspect,
      captionStyle: s.captionStyle,
      captionPosition: s.captionPosition,
      cropX: s.cropX,
      words: wordsInClip,
      // AI shots live in R2; their signed URLs come with the editor data.
      smart: smart
        ? { ...smart, broll: smart.broll.map((b) => (data.aiShotUrls[b.id] ? { ...b, assetUrl: data.aiShotUrls[b.id] } : b)) }
        : null,
    };
  }, [data, s, wordsInClip, smart]);

  if (data === undefined || (data && !s)) return <Loader2 className="animate-spin text-neutral-500" />;
  if (data === null || !s || !inputProps) {
    return (
      <div className="text-neutral-400">
        Clip not found. <Link href={`/dashboard/clips/${id}`} className="underline">Back</Link>
      </div>
    );
  }

  const dims = CLIP_DIMS[s.aspect];
  const len = s.end - s.start;
  const { window: win } = data;
  const clip = data.clip;
  const rendering = clip.renderStatus === "queued" || clip.renderStatus === "rendering";
  const pct = (t: number) => ((t - win.start) / Math.max(1, win.end - win.start)) * 100;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <Link href={`/dashboard/clips/${id}`} className="text-sm text-neutral-500 hover:text-white inline-flex items-center gap-1">
            <ArrowLeft size={14} /> {data.source.title}
          </Link>
          <input
            value={s.title}
            onChange={(e) => setS({ ...s, title: e.target.value })}
            className="block mt-2 bg-transparent text-xl font-semibold text-white outline-none border-b border-transparent focus:border-neutral-700 w-full max-w-xl"
          />
          <div className="text-xs text-neutral-500 mt-1">
            {fmt(s.start)} – {fmt(s.end)} · {len.toFixed(1)}s
            {smart ? ` → ${(clipDurationInFrames(inputProps) / CLIP_FPS).toFixed(1)}s after smart cuts` : ""}{" "}
            {saving ? "· saving…" : "· saved"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {clip.renderStatus === "done" && data.outputUrl && !rendering && (
            <a href={data.outputUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <Download size={14} className="mr-1" /> Download MP4
              </Button>
            </a>
          )}
          <Button size="sm" disabled={rendering || saving} onClick={() => exportClip({ clipId })}>
            {rendering ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                {clip.renderStatus === "queued" ? "Queued…" : `Rendering ${clip.renderProgress ?? 0}%`}
              </>
            ) : (
              <>
                <Scissors size={14} className="mr-1" /> {clip.renderStatus === "done" ? "Re-export" : "Export MP4"}
              </>
            )}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>}
      {clip.renderStatus === "failed" && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          Export failed: {clip.renderError ?? "unknown error"}
        </div>
      )}
      {clip.renderStatus === "done" && !rendering && (
        <div className="text-xs text-neutral-500">
          Exported settings are what you saw when you clicked Export. Change anything and click Re-export to update the MP4.
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <div className="flex justify-center rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <div style={{ width: "100%", maxWidth: s.aspect === "9:16" ? 380 : s.aspect === "1:1" ? 520 : 760 }}>
            <Player
              component={ClipComposition}
              inputProps={inputProps}
              durationInFrames={clipDurationInFrames(inputProps)}
              fps={CLIP_FPS}
              compositionWidth={dims.width}
              compositionHeight={dims.height}
              controls
              style={{ width: "100%", aspectRatio: `${dims.width} / ${dims.height}`, borderRadius: 8, overflow: "hidden" }}
            />
            <div className="mt-3">
              <SmartTimeline smart={smart} start={s.start} end={s.end} />
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <SmartPanel
            clipId={clipId}
            smart={smart}
            status={clip.smartStatus}
            error={clip.smartError}
            start={s.start}
            end={s.end}
            aspect={s.aspect}
            onChange={setSmart}
            onRegenerate={() => regenerateSmart({ clipId })}
          />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-300">Trim</h2>
            <div className="relative h-8 rounded-md bg-neutral-900 border border-neutral-800">
              <div
                className="absolute top-0 bottom-0 bg-sky-400/25 border-x-2 border-sky-400"
                style={{ left: `${pct(s.start)}%`, width: `${pct(s.end) - pct(s.start)}%` }}
              />
            </div>
            <label className="block text-xs text-neutral-500">
              Start {fmt(s.start)}
              <input
                type="range"
                min={win.start}
                max={win.end}
                step={0.1}
                value={s.start}
                onChange={(e) => setS({ ...s, start: Math.min(Number(e.target.value), s.end - 3) })}
                className="w-full accent-sky-400"
              />
            </label>
            <label className="block text-xs text-neutral-500">
              End {fmt(s.end)}
              <input
                type="range"
                min={win.start}
                max={win.end}
                step={0.1}
                value={s.end}
                onChange={(e) => setS({ ...s, end: Math.max(Number(e.target.value), s.start + 3) })}
                className="w-full accent-sky-400"
              />
            </label>
            <div className="flex flex-wrap gap-1">
              {[
                ["Start −0.5s", () => setS({ ...s, start: Math.max(win.start, s.start - 0.5) })],
                ["Start +0.5s", () => setS({ ...s, start: Math.min(s.end - 3, s.start + 0.5) })],
                ["End −0.5s", () => setS({ ...s, end: Math.max(s.start + 3, s.end - 0.5) })],
                ["End +0.5s", () => setS({ ...s, end: Math.min(win.end, s.end + 0.5) })],
              ].map(([label, fn]) => (
                <Button key={label as string} size="sm" variant="outline" onClick={fn as () => void}>
                  {label as string}
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-300">Format</h2>
            <Segmented value={s.aspect} options={ASPECTS} onChange={(aspect) => setS({ ...s, aspect })} />
            {s.aspect !== "16:9" && (
              <label className="block text-xs text-neutral-500">
                Frame position (left ↔ right)
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={s.cropX}
                  onChange={(e) => setS({ ...s, cropX: Number(e.target.value) })}
                  className="w-full accent-sky-400"
                />
              </label>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-300">Captions</h2>
            <Segmented value={s.captionStyle} options={STYLES} onChange={(captionStyle) => setS({ ...s, captionStyle })} />
            {s.captionStyle !== "none" && (
              <Segmented
                value={s.captionPosition}
                options={POSITIONS.map((p) => ({ key: p, label: p[0].toUpperCase() + p.slice(1) }))}
                onChange={(captionPosition) => setS({ ...s, captionPosition })}
              />
            )}
            <textarea
              value={captionDraft ?? captionText}
              onChange={(e) => setCaptionDraft(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-200 outline-none focus:border-neutral-600"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={captionDraft === null || captionDraft === captionText}
                onClick={async () => {
                  await setCaptionText({ clipId, text: captionDraft ?? "" });
                  setCaptionDraft(null);
                }}
              >
                Save caption text
              </Button>
              {clip.captionWords && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await resetCaptions({ clipId });
                    setCaptionDraft(null);
                  }}
                >
                  <RotateCcw size={14} className="mr-1" /> Reset to transcript
                </Button>
              )}
            </div>
            <p className="text-xs text-neutral-500">
              Fix typos word for word to keep exact timing. Adding or removing words spreads them evenly over the clip.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
