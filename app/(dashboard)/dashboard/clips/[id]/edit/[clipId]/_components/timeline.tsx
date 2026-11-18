"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { outputToSource, sourceToOutputSnap, type Timeline } from "@/remotion/clip-timeline";
import type { SmartEdit } from "@/types/clip";

const fmtT = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

// Group words into caption-sized blocks for the Captions lane.
function phrases(words: { s: number; e: number }[]) {
  const out: { s: number; e: number }[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.s - last.e < 0.45 && w.e - last.s < 2.6) last.e = w.e;
    else out.push({ s: w.s, e: w.e });
  }
  return out;
}

// Timeline lanes under the preview: trim, kept/removed video, zooms, B-roll,
// captions, in source time across the editable window. The playhead follows the
// Player; clicking a lane seeks there; the trim box's edges can be dragged.
export function EditorTimeline({
  playerRef,
  fps,
  timeline,
  win,
  start,
  end,
  smart,
  words,
  onTrim,
}: {
  playerRef: RefObject<PlayerRef | null>;
  fps: number;
  timeline: Timeline;
  win: { start: number; end: number };
  start: number;
  end: number;
  smart: SmartEdit | null;
  words: { s: number; e: number }[];
  onTrim: (start: number, end: number) => void;
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Player events (the Player mounts after data loads, so poll briefly for the ref).
  useEffect(() => {
    let off: (() => void) | null = null;
    let tries = 0;
    const attach = () => {
      const p = playerRef.current;
      if (!p) {
        if (tries++ < 40) t = setTimeout(attach, 100);
        return;
      }
      const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      p.addEventListener("frameupdate", onFrame);
      p.addEventListener("seeked", onFrame);
      p.addEventListener("play", onPlay);
      p.addEventListener("pause", onPause);
      p.addEventListener("ended", onPause);
      setFrame(p.getCurrentFrame());
      off = () => {
        p.removeEventListener("frameupdate", onFrame);
        p.removeEventListener("seeked", onFrame);
        p.removeEventListener("play", onPlay);
        p.removeEventListener("pause", onPause);
        p.removeEventListener("ended", onPause);
      };
    };
    let t: ReturnType<typeof setTimeout> | undefined;
    attach();
    return () => {
      if (t) clearTimeout(t);
      off?.();
    };
  }, [playerRef]);

  const span = Math.max(0.1, win.end - win.start);
  const pct = (t: number) => ((Math.min(win.end, Math.max(win.start, t)) - win.start) / span) * 100;
  const box = (s: number, e: number) => ({ left: `${pct(s)}%`, width: `${Math.max(0.4, pct(e) - pct(s))}%` });

  const outSec = frame / fps;
  const srcNow = outputToSource(timeline, outSec);

  const inClip = <T extends { t: number; dur: number; enabled: boolean }>(x: T) => x.enabled && x.t + x.dur > start && x.t < end;
  const gaps = (smart?.removals ?? []).filter((r) => r.enabled && r.e > start && r.s < end);
  const zooms = (smart?.zooms ?? []).filter(inClip);
  const broll = (smart?.broll ?? []).filter(inClip);
  const caps = useMemo(() => phrases(words.filter((w) => w.e > start && w.s < end)), [words, start, end]);

  // Lane x → source time.
  const timeAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    return win.start + ((clientX - r.left) / Math.max(1, r.width)) * span;
  };
  const seekSource = (t: number) => {
    const p = playerRef.current;
    if (!p) return;
    const clamped = Math.min(end, Math.max(start, t));
    p.seekTo(Math.max(0, Math.min(Math.round(sourceToOutputSnap(timeline, clamped) * fps), Math.ceil(timeline.duration * fps) - 1)));
  };

  // Drag the trim box's edges.
  const trimRef = useRef<HTMLDivElement>(null);
  const drag = useRef<"start" | "end" | null>(null);
  const onDown = (edge: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = edge;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !trimRef.current) return;
    const t = Math.round(timeAt(trimRef.current, e.clientX) * 10) / 10;
    if (drag.current === "start") onTrim(Math.max(win.start, Math.min(t, end - 3)), end);
    else onTrim(start, Math.min(win.end, Math.max(t, start + 3)));
  };
  const onUp = () => (drag.current = null);
  const onKey = (edge: "start" | "end") => (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -0.5 : e.key === "ArrowRight" ? 0.5 : 0;
    if (!d) return;
    e.preventDefault();
    if (edge === "start") onTrim(Math.max(win.start, Math.min(start + d, end - 3)), end);
    else onTrim(start, Math.min(win.end, Math.max(end + d, start + 3)));
  };

  const lane = "relative h-[22px] cursor-pointer overflow-hidden rounded-[5px] bg-surface-2";
  const mark = "absolute bottom-0.5 top-0.5 rounded";
  const track = (label: string, children: React.ReactNode) => (
    <div className="grid grid-cols-[54px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[62px_minmax(0,1fr)]">
      <span className="text-[11px] text-faint">{label}</span>
      <div className={lane} onClick={(e) => seekSource(timeAt(e.currentTarget, e.clientX))}>
        {children}
      </div>
    </div>
  );

  return (
    <div className="grid gap-1.5 border-t border-line bg-surface px-3.5 pb-3.5 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5 font-mono text-xs text-faint">
        <button
          type="button"
          onClick={() => playerRef.current?.toggle()}
          className="inline-flex h-8 items-center gap-2.5 text-fg"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
          <span className="tabular">
            {fmtT(outSec)} / {fmtT(timeline.duration)}
          </span>
        </button>
        <span className="max-sm:hidden">Drag the white box to trim · ±0.5s with arrow keys</span>
      </div>

      <div className="relative grid gap-1.5">
        <div className="grid grid-cols-[54px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[62px_minmax(0,1fr)]">
          <span className="text-[11px] text-faint">Trim</span>
          <div
            ref={trimRef}
            className="relative h-[26px] touch-none rounded-[5px] bg-surface-2"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onClick={(e) => seekSource(timeAt(e.currentTarget, e.clientX))}
          >
            <i className="absolute inset-y-0.5 left-0 right-0 rounded bg-[#3a3a42] opacity-40" />
            <i className="absolute inset-y-0 rounded-[5px] border-2 border-fg bg-fg/[.08]" style={box(start, end)}>
              {(["start", "end"] as const).map((edge) => (
                <span
                  key={edge}
                  role="slider"
                  tabIndex={0}
                  aria-label={edge === "start" ? "Clip start" : "Clip end"}
                  aria-valuemin={win.start}
                  aria-valuemax={win.end}
                  aria-valuenow={edge === "start" ? start : end}
                  onPointerDown={onDown(edge)}
                  onKeyDown={onKey(edge)}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "absolute inset-y-0 w-4 cursor-ew-resize outline-none focus-visible:bg-fg/30",
                    edge === "start" ? "-left-2" : "-right-2"
                  )}
                >
                  <span className="absolute inset-y-1 left-1/2 w-[3px] -translate-x-1/2 rounded bg-fg" />
                </span>
              ))}
            </i>
          </div>
        </div>
        {track(
          "Video",
          <>
          {timeline.segments.map((g, i) => (
            <i key={i} className={cn(mark, "bg-[#3a3a42]")} style={box(g.s, g.e)} />
          ))}
          {gaps.map((r) => (
            <i
              key={r.id}
              title={`${r.reason} · ${(Math.min(end, r.e) - Math.max(start, r.s)).toFixed(1)}s cut`}
              className={cn(mark, "bg-[repeating-linear-gradient(135deg,rgba(242,114,122,.35)_0_3px,transparent_3px_6px)]")}
              style={box(Math.max(start, r.s), Math.min(end, r.e))}
            />
          ))}
          </>
        )}
        {track(
          "Zooms",
          <>
          {zooms.map((z) => (
            <i key={z.id} className={cn(mark, "bg-[rgba(111,168,255,.45)]")} style={box(z.t, z.t + z.dur)} />
          ))}
          </>
        )}
        {track(
          "B-roll",
          <>
          {broll.map((b) => (
            <i key={b.id} className={cn(mark, "bg-accent/55")} style={box(b.t, b.t + b.dur)} />
          ))}
          </>
        )}
        {track(
          "Captions",
          <>
          {caps.map((c, i) => (
            <i key={i} className={cn(mark, "bg-fg/[.22]")} style={box(c.s, c.e)} />
          ))}
          </>
        )}

        {/* Playhead across the lanes */}
        <div className="pointer-events-none absolute inset-y-0 left-[62px] right-0 sm:left-[70px]">
          <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${pct(srcNow)}%` }} />
        </div>
      </div>
    </div>
  );
}
