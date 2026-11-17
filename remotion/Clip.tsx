import React, { useMemo } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { FONTS } from "./fonts";
import { getTheme } from "./theme";
import { TEMPLATE_COMPONENTS } from "./registry";
import { Footage, TitleCard } from "./templates";
import {
  buildTimeline,
  interpTrack,
  outputToSource,
  segmentIndexAt,
  sourceToOutput,
  sourceToOutputSnap,
  type Timeline,
} from "./clip-timeline";
import {
  CLIP_FPS,
  type CaptionStyle,
  type ClipCompositionProps,
  type ClipWord,
  type SmartEdit,
  type SmartHighlight,
} from "../types/clip";

const montserrat = loadMontserrat("normal", { weights: ["800", "900"] }).fontFamily;

// ── Timeline from props ──

export function clipTimeline(p: Pick<ClipCompositionProps, "start" | "end" | "smart">): Timeline {
  const removals = (p.smart?.removals ?? []).filter((r) => r.enabled);
  return buildTimeline(p.start, p.end, removals);
}

export const clipDurationInFrames = (p: Pick<ClipCompositionProps, "start" | "end" | "smart">) =>
  Math.max(1, Math.ceil(clipTimeline(p).duration * CLIP_FPS));

// Words mapped to output time (cut words are dropped).
type OutWord = ClipWord & { hl?: SmartHighlight };

function outputWords(words: ClipWord[], tl: Timeline, highlights: SmartHighlight[]): OutWord[] {
  const out: OutWord[] = [];
  for (const w of words) {
    const mid = (w.s + w.e) / 2;
    if (sourceToOutput(tl, mid) === null) continue;
    const s = sourceToOutputSnap(tl, w.s);
    const e = Math.max(s + 0.05, sourceToOutputSnap(tl, w.e));
    const hl = highlights.find((h) => Math.abs(h.t - w.s) < 0.25);
    out.push({ w: w.w, s, e, hl });
  }
  return out;
}

// ── Caption paging ──

type Page = { words: OutWord[]; start: number; end: number };

export function pageWords(words: OutWord[], maxWords = 4): Page[] {
  const pages: Page[] = [];
  let cur: OutWord[] = [];
  const flush = () => {
    if (cur.length) pages.push({ words: cur, start: cur[0].s, end: cur[cur.length - 1].e });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= maxWords || w.s - prev.e > 0.6)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.w)) flush();
  }
  flush();
  return pages;
}

const STYLE: Record<Exclude<CaptionStyle, "none">, { font: string; weight: number; upper: boolean; maxWords: number }> = {
  bold: { font: montserrat, weight: 900, upper: true, maxWords: 3 },
  karaoke: { font: montserrat, weight: 800, upper: false, maxWords: 5 },
  clean: { font: FONTS.nunito, weight: 800, upper: false, maxWords: 6 },
};

const Captions: React.FC<{
  words: OutWord[];
  style: Exclude<CaptionStyle, "none">;
  position: ClipCompositionProps["captionPosition"];
}> = ({ words, style, position }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const cfg = STYLE[style];
  const pages = useMemo(() => pageWords(words, cfg.maxWords), [words, cfg.maxWords]);
  const idx = pages.findLastIndex((p) => p.start <= t + 0.05);
  const page = idx >= 0 ? pages[idx] : null;
  if (!page) return null;
  const next = pages[idx + 1];
  if (t > page.end + 0.8 && (!next || t < next.start)) return null;

  const fontSize = Math.round(Math.min(width, height) * (style === "clean" ? 0.06 : 0.075));
  const pop = spring({ frame: frame - Math.round(page.start * fps), fps, config: { damping: 14, stiffness: 180 } });
  const scale = interpolate(pop, [0, 1], [0.85, 1]);
  const justify = position === "top" ? "flex-start" : position === "middle" ? "center" : "flex-end";
  const pad = position === "middle" ? 0 : Math.round(height * (position === "top" ? 0.12 : 0.16));

  // Emoji for this page (first highlighted word with one), popping above the line.
  const emojiWord = page.words.find((w) => w.hl?.emoji);
  const emojiPop = emojiWord
    ? spring({ frame: frame - Math.round(emojiWord.s * fps), fps, config: { damping: 9, stiffness: 160 } })
    : 0;

  return (
    <AbsoluteFill style={{ justifyContent: justify, alignItems: "center", paddingTop: pad, paddingBottom: pad }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: fontSize * 0.2 }}>
        {emojiWord && t >= emojiWord.s ? (
          <div style={{ fontSize: fontSize * 1.6, transform: `scale(${emojiPop}) rotate(${(1 - emojiPop) * -20}deg)` }}>
            {emojiWord.hl!.emoji}
          </div>
        ) : null}
        <div
          style={{
            maxWidth: width * 0.86,
            textAlign: "center",
            transform: `scale(${scale})`,
            fontFamily: cfg.font,
            fontWeight: cfg.weight,
            fontSize,
            lineHeight: 1.15,
            textTransform: cfg.upper ? "uppercase" : "none",
            ...(style === "clean"
              ? { background: "rgba(0,0,0,0.6)", borderRadius: fontSize * 0.35, padding: `${fontSize * 0.25}px ${fontSize * 0.5}px` }
              : {}),
          }}
        >
          {page.words.map((w, i) => {
            const active = t >= w.s && t < (page.words[i + 1]?.s ?? w.e + 0.3);
            const spoken = t >= w.s;
            const hlColor = w.hl?.color;
            // Margin wide enough that a scaled-up highlighted word never touches its neighbour.
            const base: React.CSSProperties = {
              display: "inline-block",
              margin: `0 ${fontSize * 0.22}px`,
              color: "#fff",
              transformOrigin: "center bottom",
            };
            if (style === "bold") {
              return (
                <span
                  key={i}
                  style={{
                    ...base,
                    color: active ? "#FFE600" : hlColor ?? "#fff",
                    WebkitTextStroke: `${Math.max(2, fontSize * 0.06)}px #000`,
                    paintOrder: "stroke fill",
                    textShadow: "0 6px 18px rgba(0,0,0,0.55)",
                    transform: active ? "scale(1.08)" : "none",
                  }}
                >
                  {w.w}
                </span>
              );
            }
            if (style === "karaoke") {
              return (
                <span
                  key={i}
                  style={{
                    ...base,
                    color: hlColor && !active ? hlColor : "#fff",
                    opacity: spoken ? 1 : 0.55,
                    background: active ? "#7C3AED" : "transparent",
                    borderRadius: fontSize * 0.2,
                    padding: `0 ${fontSize * 0.12}px`,
                    textShadow: active ? "none" : "0 4px 14px rgba(0,0,0,0.6)",
                  }}
                >
                  {w.w}
                </span>
              );
            }
            return (
              <span key={i} style={{ ...base, color: hlColor ?? "#fff" }}>
                {w.w}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── Video layer: kept segments, reframe, zooms, jump-cut punch ──


const VideoLayer: React.FC<{
  props: ClipCompositionProps;
  tl: Timeline;
}> = ({ props, tl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = frame / fps;
  const smart = props.smart;
  const src = outputToSource(tl, o);

  // Reframe: follow the tracked face, else the manual crop. objectPosition p
  // places the visible window; to centre a face at fraction fx of the source
  // width: p = (fx - r/2) / (1 - r), with r = visible fraction of the width.
  const { width, height } = useVideoConfig();
  let x = props.cropX;
  const track = smart?.reframe.track ?? [];
  if (smart?.reframe.enabled && track.length > 0 && smart.reframe.srcAspect) {
    const r = width / height / smart.reframe.srcAspect;
    const fx = interpTrack(track, src, 0.5);
    x = r >= 1 ? 0.5 : Math.max(0, Math.min(1, (fx - r / 2) / (1 - r)));
  }

  // Zooms (in source time): ease in 0.3 s, hold, ease out 0.3 s.
  let zoom = 1;
  for (const z of smart?.zooms ?? []) {
    if (!z.enabled || src < z.t || src > z.t + z.dur) continue;
    const k = Math.min(1, (src - z.t) / 0.3, (z.t + z.dur - src) / 0.3);
    zoom = Math.max(zoom, 1 + (z.scale - 1) * Math.max(0, k));
  }
  // Jump-cut punch: alternate framing on every cut so cuts feel intentional.
  if (smart?.anim.cutPunch && tl.segments.length > 1 && segmentIndexAt(tl, o) % 2 === 1) zoom *= 1.08;

  // One OffthreadVideo per kept segment, sharing a style.
  const segments = (style: React.CSSProperties, muted = false) =>
    tl.segments.map((seg, i) => {
      const from = Math.round(seg.out * fps);
      const dur = Math.max(1, Math.round((seg.e - seg.s) * fps));
      return (
        <Sequence key={i} from={from} durationInFrames={dur} premountFor={fps}>
          <OffthreadVideo
            src={props.videoUrl}
            muted={muted}
            trimBefore={Math.max(0, Math.round((seg.s - props.videoOffsetSec) * fps))}
            style={style}
          />
        </Sequence>
      );
    });

  // Fit: the whole video, centred, with black or blurred bars around it.
  if (props.framing === "fit") {
    return (
      <AbsoluteFill>
        {props.fitBackground === "blur" ? (
          props.blurVideoUrl ? (
            // Export: tiny pre-blurred video from the worker, just stretched.
            <AbsoluteFill style={{ transform: "scale(1.15)" }}>
              {tl.segments.map((seg, i) => (
                <Sequence
                  key={i}
                  from={Math.round(seg.out * fps)}
                  durationInFrames={Math.max(1, Math.round((seg.e - seg.s) * fps))}
                  premountFor={fps}
                >
                  <OffthreadVideo
                    src={props.blurVideoUrl!}
                    muted
                    trimBefore={Math.max(0, Math.round((seg.s - props.videoOffsetSec) * fps))}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </Sequence>
              ))}
            </AbsoluteFill>
          ) : (
            // Preview: blur in the browser (GPU), muted so audio isn't doubled.
            <AbsoluteFill style={{ transform: "scale(1.2)" }}>
              {segments(
                { width: "100%", height: "100%", objectFit: "cover", filter: "blur(40px) brightness(0.55) saturate(1.2)" },
                true
              )}
            </AbsoluteFill>
          )
        ) : null}
        <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}>
          {segments({ width: "100%", height: "100%", objectFit: "contain" })}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  // Fill: crop to the frame, following the face (or the manual crop).
  return (
    <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: `${x * 100}% 40%` }}>
      {segments({
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `${Math.max(0, Math.min(1, x)) * 100}% 50%`,
      })}
    </AbsoluteFill>
  );
};

// ── Overlays ──

const Hook: React.FC<{ text: string; durationSec: number }> = ({ text, durationSec }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 140 } });
  const exit = interpolate(frame, [durationSec * fps - 8, durationSec * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fontSize = Math.round(Math.min(width, height) * 0.068);
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: height * 0.08 }}>
      <div
        style={{
          maxWidth: width * 0.86,
          background: "#fff",
          color: "#000",
          fontFamily: montserrat,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.12,
          textAlign: "center",
          padding: `${fontSize * 0.35}px ${fontSize * 0.6}px`,
          borderRadius: fontSize * 0.3,
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          transform: `translateY(${(1 - enter) * -60}px) scale(${0.9 + enter * 0.1}) rotate(-1.5deg)`,
          opacity: Math.min(enter, exit),
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const h = Math.max(6, Math.round(height * 0.006));
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end" }}>
      <div style={{ height: h, width: (width * frame) / Math.max(1, durationInFrames - 1), background: "#FFE600" }} />
    </AbsoluteFill>
  );
};

const EndCta: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 12, stiffness: 150 } });
  const fontSize = Math.round(Math.min(width, height) * 0.06);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", background: `rgba(0,0,0,${0.45 * enter})` }}>
      <div
        style={{
          fontFamily: montserrat,
          fontWeight: 900,
          fontSize,
          color: "#fff",
          textAlign: "center",
          maxWidth: width * 0.8,
          background: "#7C3AED",
          padding: `${fontSize * 0.4}px ${fontSize * 0.7}px`,
          borderRadius: fontSize * 0.4,
          transform: `scale(${enter})`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const BrollOverlays: React.FC<{ smart: SmartEdit; tl: Timeline }> = ({ smart, tl }) => {
  const { fps } = useVideoConfig();
  const theme = getTheme(smart.theme);
  return (
    <>
      {smart.broll
        .filter((b) => b.enabled && (b.kind === "template" || b.assetUrl))
        .map((b) => {
          const start = sourceToOutput(tl, b.t);
          if (start === null) return null;
          const dur = Math.min(b.dur, tl.duration - start);
          if (dur < 0.5) return null;
          const Comp = b.kind === "template" ? TEMPLATE_COMPONENTS[b.template ?? ""] ?? TitleCard : Footage;
          return (
            <Sequence key={b.id} from={Math.round(start * fps)} durationInFrames={Math.round(dur * fps)} premountFor={fps}>
              <Comp
                props={b.props ?? {}}
                theme={theme}
                caption={null}
                query={b.query}
                assetRef={b.assetUrl ?? undefined}
                assetType={b.assetType ?? "video"}
              />
            </Sequence>
          );
        })}
    </>
  );
};

// ── Root ──

export const ClipComposition: React.FC<ClipCompositionProps> = (props) => {
  const { fps } = useVideoConfig();
  const tl = useMemo(() => clipTimeline(props), [props]);
  const smart = props.smart;
  const highlights = useMemo(() => (smart?.highlights ?? []).filter((h) => h.enabled), [smart]);
  const words = useMemo(() => outputWords(props.words, tl, highlights), [props.words, tl, highlights]);
  const ctaFrames = Math.round(Math.min(2, tl.duration / 3) * fps);
  const totalFrames = Math.max(1, Math.ceil(tl.duration * fps));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.videoUrl ? <VideoLayer props={props} tl={tl} /> : null}
      {smart ? <BrollOverlays smart={smart} tl={tl} /> : null}
      {props.captionStyle !== "none" && words.length > 0 ? (
        <Captions words={words} style={props.captionStyle} position={props.captionPosition} />
      ) : null}
      {smart?.hook.enabled && smart.hook.text ? (
        <Sequence durationInFrames={Math.round(Math.min(smart.hook.durationSec, tl.duration) * fps)}>
          <Hook text={smart.hook.text} durationSec={Math.min(smart.hook.durationSec, tl.duration)} />
        </Sequence>
      ) : null}
      {smart?.anim.endCta.enabled && smart.anim.endCta.text ? (
        <Sequence from={totalFrames - ctaFrames} durationInFrames={ctaFrames}>
          <EndCta text={smart.anim.endCta.text} />
        </Sequence>
      ) : null}
      {smart?.anim.progressBar ? <ProgressBar /> : null}
    </AbsoluteFill>
  );
};
