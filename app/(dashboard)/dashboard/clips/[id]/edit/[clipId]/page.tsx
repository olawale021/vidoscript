"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Player, type PlayerRef } from "@remotion/player";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Captions, Crop, Loader2, RotateCcw, Scissors, Send, Wand2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { SaveVideoButton } from "@/components/save-video-button";
import { PostButton } from "@/components/post-button";
import { cn } from "@/lib/utils";
import { ClipComposition, clipDurationInFrames, clipTimeline } from "@/remotion/Clip";
import { Segmented } from "@/components/ui/kit";
import {
  CLIP_DEFAULTS,
  CLIP_DIMS,
  CLIP_FPS,
  type CaptionPosition,
  type CaptionStyle,
  type ClipAspect,
  type ClipCompositionProps,
  type FitBackground,
  type Framing,
  type SmartEdit,
} from "@/types/clip";
import { SmartPanel } from "./_components/smart-panel";
import { EditorTimeline } from "./_components/timeline";
import { PostCopy } from "./_components/post-copy";

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

type PanelKey = "smart" | "captions" | "format" | "post";
const PANELS: { key: PanelKey; label: string; icon: typeof Wand2 }[] = [
  { key: "smart", label: "Smart", icon: Wand2 },
  { key: "captions", label: "Captions", icon: Captions },
  { key: "format", label: "Format", icon: Crop },
  { key: "post", label: "Post", icon: Send },
];

// One inspector option block (".opt" in the design).
function Opt({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line px-4 py-3">
      {label && <span className="text-xs text-faint">{label}</span>}
      {children}
    </div>
  );
}

function InspHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
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
    framing: Framing;
    fitBackground: FitBackground;
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
        framing: c.framing ?? CLIP_DEFAULTS.framing,
        fitBackground: c.fitBackground ?? CLIP_DEFAULTS.fitBackground,
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
      framing: s.framing,
      fitBackground: s.fitBackground,
      words: wordsInClip,
      // AI shots live in R2; their signed URLs come with the editor data.
      smart: smart
        ? { ...smart, broll: smart.broll.map((b) => (data.aiShotUrls[b.id] ? { ...b, assetUrl: data.aiShotUrls[b.id] } : b)) }
        : null,
    };
  }, [data, s, wordsInClip, smart]);

  const playerRef = useRef<PlayerRef>(null);
  const [panel, setPanel] = useState<PanelKey>("smart");
  const timeline = useMemo(() => (inputProps ? clipTimeline(inputProps) : null), [inputProps]);

  if (data === undefined || (data && !s)) return <Loader2 className="animate-spin text-faint" />;
  if (data === null || !s || !inputProps || !timeline) {
    return (
      <div className="text-muted">
        Clip not found.{" "}
        <Link href={`/dashboard/clips/${id}`} className="underline">
          Back
        </Link>
      </div>
    );
  }

  const dims = CLIP_DIMS[s.aspect];
  const len = s.end - s.start;
  const { window: win } = data;
  const clip = data.clip;
  const rendering = clip.renderStatus === "queued" || clip.renderStatus === "rendering";
  const nudge = (label: string, fn: () => void) => (
    <Button key={label} size="sm" variant="outline" onClick={fn}>
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4 max-sm:pb-16">
      <div className="space-y-2">
        <Link href={`/dashboard/clips/${id}`} className="inline-flex max-w-full items-center gap-1.5 text-[13px] text-faint hover:text-fg">
          <ArrowLeft size={14} className="flex-shrink-0" /> <span className="truncate">{data.source.title}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <input
              value={s.title}
              onChange={(e) => setS({ ...s, title: e.target.value })}
              aria-label="Clip title"
              className="w-full border-b border-dashed border-transparent bg-transparent text-xl font-semibold tracking-tight text-fg outline-none focus:border-line-strong"
            />
            <div className="mt-0.5 font-mono text-xs text-faint tabular">
              {fmt(s.start)} – {fmt(s.end)} · {len.toFixed(1)}s
              {smart ? ` → ${(clipDurationInFrames(inputProps) / CLIP_FPS).toFixed(1)}s after smart cuts` : ""} ·{" "}
              {saving ? <span className="text-accent">saving…</span> : <span className="text-ok">saved</span>}
            </div>
          </div>
          {clip.renderStatus === "done" && data.downloadUrl && !rendering && (
            <>
              <PostButton sourceType="clip" sourceId={clipId} size="sm" />
              <SaveVideoButton downloadUrl={data.downloadUrl} fileName={`${s.title || "clip"}.mp4`} />
            </>
          )}
          <Button
            size="sm"
            disabled={rendering || saving}
            onClick={() => exportClip({ clipId })}
            className="max-sm:fixed max-sm:bottom-[calc(70px+env(safe-area-inset-bottom))] max-sm:left-4 max-sm:right-4 max-sm:z-30 max-sm:h-[46px] max-sm:text-[15px] max-sm:shadow-[0_10px_30px_rgba(0,0,0,.6)]"
          >
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

      {error && <div className="rounded-[10px] border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">{error}</div>}
      {clip.renderStatus === "failed" && (
        <div className="rounded-[10px] border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          Export failed: {clip.renderError ?? "unknown error"}
        </div>
      )}
      {clip.renderStatus === "done" &&
        !rendering &&
        (() => {
          const outAspect = clip.renderedAspect;
          const outFraming = clip.renderedFraming;
          const mismatch =
            (outAspect && outAspect !== s.aspect) || (outFraming && s.aspect !== "16:9" && outFraming !== s.framing);
          return mismatch ? (
            <div className="rounded-[10px] border border-accent/35 bg-accent-soft px-4 py-2 text-sm text-accent">
              Your downloaded MP4 is <b>{outAspect}</b>
              {outFraming && outAspect !== "16:9" ? ` (${outFraming === "fit" ? "full video" : "cropped"})` : ""}, but this
              clip is now set to <b>{s.aspect}</b>
              {s.aspect !== "16:9" ? ` (${s.framing === "fit" ? "full video" : "cropped"})` : ""}. Click <b>Re-export</b> to
              update it, otherwise YouTube / TikTok will crop it.
            </div>
          ) : null;
        })()}

      <div className="grid overflow-hidden rounded-[18px] border border-line bg-surface sm:grid-cols-[56px_minmax(0,1fr)] xl:min-h-[620px] xl:grid-cols-[64px_minmax(0,1fr)_340px]">
        {/* Rail: picks the inspector panel (a tab row on phones) */}
        <div
          role="tablist"
          aria-label="Editor panels"
          className="flex gap-1 overflow-x-auto border-b border-line p-2 sm:grid sm:content-start sm:border-b-0 sm:border-r sm:px-2 sm:py-2.5"
        >
          {PANELS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={panel === key}
              onClick={() => setPanel(key)}
              className={cn(
                "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-xs transition sm:grid sm:flex-none sm:justify-items-center sm:gap-1 sm:px-0 sm:py-2 sm:text-[10px]",
                panel === key ? "bg-surface-3 text-fg" : "text-faint hover:bg-surface-2 hover:text-fg"
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {/* Canvas: preview + timeline */}
        <div className="grid min-w-0 grid-rows-[1fr_auto] bg-bg">
          <div className="grid place-items-center p-4 sm:p-6">
            <div
              style={{ width: "100%", maxWidth: s.aspect === "9:16" ? 300 : s.aspect === "1:1" ? 440 : 680 }}
              className="max-sm:max-w-[260px]"
            >
              <Player
                ref={playerRef}
                component={ClipComposition}
                inputProps={inputProps}
                durationInFrames={clipDurationInFrames(inputProps)}
                fps={CLIP_FPS}
                compositionWidth={dims.width}
                compositionHeight={dims.height}
                controls
                style={{
                  width: "100%",
                  aspectRatio: `${dims.width} / ${dims.height}`,
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "0 30px 60px -20px rgba(0,0,0,.9)",
                }}
              />
            </div>
          </div>
          <EditorTimeline
            playerRef={playerRef}
            fps={CLIP_FPS}
            timeline={timeline}
            win={win}
            start={s.start}
            end={s.end}
            smart={smart}
            words={wordsInClip}
            onTrim={(start, end) => setS({ ...s, start, end })}
          />
        </div>

        {/* Inspector */}
        <aside className="min-w-0 border-t border-line sm:col-span-2 xl:col-span-1 xl:max-h-[760px] xl:overflow-y-auto xl:border-l xl:border-t-0">
          {panel === "smart" && (
            <SmartPanel
              clipId={clipId}
              clipTitle={s.title}
              words={data.words}
              smart={smart}
              status={clip.smartStatus}
              error={clip.smartError}
              start={s.start}
              end={s.end}
              aspect={s.aspect}
              onChange={setSmart}
              onRegenerate={() => regenerateSmart({ clipId })}
            />
          )}

          {panel === "captions" && (
            <>
              <InspHead title="Captions" />
              <Opt label="Style">
                <Segmented
                  label="Caption style"
                  value={s.captionStyle}
                  options={STYLES.map((o) => ({ value: o.key, label: o.key === "none" ? "Off" : o.label }))}
                  onChange={(captionStyle) => setS({ ...s, captionStyle })}
                />
              </Opt>
              {s.captionStyle !== "none" && (
                <Opt label="Position">
                  <Segmented
                    label="Caption position"
                    value={s.captionPosition}
                    options={POSITIONS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
                    onChange={(captionPosition) => setS({ ...s, captionPosition })}
                  />
                </Opt>
              )}
              <Opt label="Text">
                <textarea
                  value={captionDraft ?? captionText}
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  rows={6}
                  aria-label="Caption text"
                  className="min-h-[60px] w-full resize-y rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 text-base text-fg outline-none focus:border-neutral-600 sm:text-sm"
                />
                <p className="text-xs text-faint">
                  Fix typos word for word to keep exact timing. Adding or removing words spreads them evenly over the clip.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    disabled={captionDraft === null || captionDraft === captionText}
                    onClick={async () => {
                      await setCaptionText({ clipId, text: captionDraft ?? "" });
                      setCaptionDraft(null);
                    }}
                  >
                    Save text
                  </Button>
                  {clip.captionWords && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await resetCaptions({ clipId });
                        setCaptionDraft(null);
                      }}
                    >
                      <RotateCcw size={14} className="mr-1" /> Reset to transcript
                    </Button>
                  )}
                </div>
              </Opt>
            </>
          )}

          {panel === "format" && (
            <>
              <InspHead title="Format" />
              <Opt label="Aspect">
                <Segmented
                  label="Aspect ratio"
                  value={s.aspect}
                  options={ASPECTS.map((o) => ({ value: o.key, label: o.key, title: o.label }))}
                  onChange={(aspect) => setS({ ...s, aspect })}
                />
                <p className="text-xs text-faint">{ASPECTS.find((o) => o.key === s.aspect)?.label}</p>
              </Opt>
              {s.aspect !== "16:9" && (
                <Opt label="Framing">
                  <Segmented
                    label="Framing"
                    value={s.framing}
                    options={[
                      { value: "fit" as Framing, label: "Fit · full video" },
                      { value: "fill" as Framing, label: "Fill · follow face" },
                    ]}
                    onChange={(framing) => setS({ ...s, framing })}
                  />
                  <p className="text-xs text-faint">
                    {s.framing === "fit"
                      ? "Fit keeps the whole frame, so YouTube Shorts won't crop it."
                      : "Fill crops to the speaker and follows their face."}
                  </p>
                </Opt>
              )}
              {s.aspect !== "16:9" && s.framing === "fit" && (
                <Opt label="Background">
                  <Segmented
                    label="Background"
                    value={s.fitBackground}
                    options={[
                      { value: "blur" as FitBackground, label: "Blurred" },
                      { value: "black" as FitBackground, label: "Black bars" },
                    ]}
                    onChange={(fitBackground) => setS({ ...s, fitBackground })}
                  />
                </Opt>
              )}
              {s.aspect !== "16:9" && s.framing === "fill" && (
                <Opt label="Frame position (left ↔ right)">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={s.cropX}
                    aria-label="Frame position"
                    onChange={(e) => setS({ ...s, cropX: Number(e.target.value) })}
                    className="h-8 w-full accent-[var(--color-fg)]"
                  />
                </Opt>
              )}
              <Opt label="Trim">
                <div className="grid gap-1 font-mono text-xs text-muted">
                  <label className="grid gap-1 rounded-md bg-surface-2 px-2 py-1.5">
                    <span className="flex justify-between">
                      <span>Start</span>
                      <span className="tabular">{fmt(s.start)}</span>
                    </span>
                    <input
                      type="range"
                      min={win.start}
                      max={win.end}
                      step={0.1}
                      value={s.start}
                      onChange={(e) => setS({ ...s, start: Math.min(Number(e.target.value), s.end - 3) })}
                      className="h-6 w-full accent-[var(--color-fg)]"
                    />
                  </label>
                  <label className="grid gap-1 rounded-md bg-surface-2 px-2 py-1.5">
                    <span className="flex justify-between">
                      <span>End</span>
                      <span className="tabular">{fmt(s.end)}</span>
                    </span>
                    <input
                      type="range"
                      min={win.start}
                      max={win.end}
                      step={0.1}
                      value={s.end}
                      onChange={(e) => setS({ ...s, end: Math.max(Number(e.target.value), s.start + 3) })}
                      className="h-6 w-full accent-[var(--color-fg)]"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {nudge("Start −0.5s", () => setS({ ...s, start: Math.max(win.start, s.start - 0.5) }))}
                  {nudge("Start +0.5s", () => setS({ ...s, start: Math.min(s.end - 3, s.start + 0.5) }))}
                  {nudge("End −0.5s", () => setS({ ...s, end: Math.max(s.start + 3, s.end - 0.5) }))}
                  {nudge("End +0.5s", () => setS({ ...s, end: Math.min(win.end, s.end + 0.5) }))}
                </div>
              </Opt>
            </>
          )}

          {/* Kept mounted so an unsaved caption/hashtag edit survives switching panels. */}
          <div hidden={panel !== "post"}>
            <PostCopy
              clipId={clipId}
              title={s.title}
              hook={clip.hook}
              transcript={captionText}
              savedCaption={clip.postCaption}
              savedHashtags={clip.hashtags}
            />
          </div>

          <div className="flex items-center gap-2.5 px-4 py-3 text-xs text-faint">
            {rendering ? (
              <span className="text-accent">
                {clip.renderStatus === "queued" ? "Export queued…" : `Rendering ${clip.renderProgress ?? 0}%`}
              </span>
            ) : clip.renderStatus === "done" ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  MP4 ready{clip.renderedAspect ? ` · ${clip.renderedAspect}` : ""}. Change anything and click Re-export to update it.
                </span>
                {data.downloadUrl && <PostButton sourceType="clip" sourceId={clipId} size="sm" />}
              </span>
            ) : (
              <span>Not exported yet.</span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
