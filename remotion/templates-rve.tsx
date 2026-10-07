/**
 * Templates adapted from the free RVE template set
 * (https://www.reactvideoeditor.com/remotion-templates — "free to use, credit
 * appreciated"). Rewritten to be theme-aware and prop-driven so the AI planner
 * can mix them with the native templates. Raw originals live in remotion/rve/.
 */
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Caption, Shell, TemplateProps, list, num, str, useEnter } from "./templates";

// Typewriter — types text out with a blinking cursor.
export function Typewriter({ props, theme, caption }: TemplateProps) {
  const frame = useCurrentFrame();
  const text = str(props, "text", "");
  const chars = Math.floor(interpolate(frame, [4, 4 + text.length * 2], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const showCursor = Math.floor(frame / 15) % 2 === 0;
  return (
    <Shell theme={theme}>
      <div style={{ color: theme.fg, fontSize: 72, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>
        {text.slice(0, chars)}
        <span style={{ color: theme.accent, opacity: showCursor ? 1 : 0 }}>|</span>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// GlitchText — RGB split glitch that settles.
export function GlitchText({ props, theme, caption }: TemplateProps) {
  const frame = useCurrentFrame();
  const text = str(props, "text", "");
  const decay = interpolate(frame, [0, 25], [10, 0], { extrapolateRight: "clamp" });
  const jitter = (seed: number) => (Math.sin(frame * seed) * decay);
  const base: React.CSSProperties = { position: "absolute", fontSize: 96, fontWeight: 800, whiteSpace: "nowrap" };
  return (
    <Shell theme={theme}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: 140 }}>
        <div style={{ ...base, color: "#ff003c", transform: `translate(${jitter(0.9)}px,0)`, mixBlendMode: "screen" }}>{text}</div>
        <div style={{ ...base, color: "#00e5ff", transform: `translate(${-jitter(1.3)}px,0)`, mixBlendMode: "screen" }}>{text}</div>
        <div style={{ ...base, color: theme.fg }}>{text}</div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// LowerThird — broadcast-style slide-in name bar.
export function LowerThird({ props, theme, caption }: TemplateProps) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const slide = spring({ frame, fps, from: -600, to: 0, durationInFrames: 24, config: { damping: 15 } });
  const textIn = useEnter(10);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${theme.bg}, ${theme.bgAccent})`, fontFamily: theme.font, justifyContent: "flex-end", paddingBottom: 220, paddingLeft: 80 }}>
      <div style={{ transform: `translateX(${slide}px)`, display: "flex", alignItems: "stretch", gap: 0 }}>
        <div style={{ width: 12, background: theme.accent }} />
        <div style={{ background: theme.bgAccent, padding: "24px 40px", opacity: textIn }}>
          <div style={{ color: theme.fg, fontSize: 60, fontWeight: 800 }}>{str(props, "title", "Title")}</div>
          {str(props, "subtitle") && (
            <div style={{ color: theme.accent2, fontSize: 36, marginTop: 6 }}>{str(props, "subtitle")}</div>
          )}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </AbsoluteFill>
  );
}

// ChapterTitle — big index number + title.
export function ChapterTitle({ props, theme, caption }: TemplateProps) {
  const e = useEnter();
  const e2 = useEnter(8);
  const chapter = props.chapter ?? "";
  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: theme.accent, fontSize: 260, fontWeight: 800, lineHeight: 0.9, opacity: e, transform: `scale(${0.85 + e * 0.15})` }}>
          {String(chapter)}
        </div>
        <div style={{ color: theme.fg, fontSize: 64, fontWeight: 700, marginTop: 10, opacity: e2 }}>
          {str(props, "title", "")}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// CinematicIntro — letterbox bars + fade-up title.
export function CinematicIntro({ props, theme, caption }: TemplateProps) {
  const frame = useCurrentFrame();
  const bars = interpolate(frame, [0, 20], [0, 140], { extrapolateRight: "clamp" });
  const e = useEnter(12);
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font, justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: bars, background: "#000" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: bars, background: "#000" }} />
      <div style={{ textAlign: "center", opacity: e, transform: `translateY(${(1 - e) * 24}px)`, letterSpacing: 6 }}>
        <div style={{ color: theme.fg, fontSize: 88, fontWeight: 800, textTransform: "uppercase" }}>{str(props, "title", "Title")}</div>
        {str(props, "subtitle") && (
          <div style={{ color: theme.muted, fontSize: 40, marginTop: 20 }}>{str(props, "subtitle")}</div>
        )}
      </div>
      <Caption text={caption} theme={theme} />
    </AbsoluteFill>
  );
}

// EndCard — outro with title + CTA.
export function EndCard({ props, theme, caption }: TemplateProps) {
  const e = useEnter();
  const e2 = useEnter(10);
  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: theme.fg, fontSize: 84, fontWeight: 800, opacity: e, transform: `translateY(${(1 - e) * 20}px)` }}>
          {str(props, "title", "Thanks for watching")}
        </div>
        {str(props, "cta") && (
          <div style={{ marginTop: 40, display: "inline-block", padding: "18px 44px", borderRadius: 999, background: theme.accent, color: theme.bg, fontSize: 44, fontWeight: 700, opacity: e2 }}>
            {str(props, "cta")}
          </div>
        )}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

function Ring({ value, label, theme }: { value: number; label: string; theme: { fg: string; muted: string; accent: string; bgAccent: string } }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pct = interpolate(frame, [0, fps], [0, Math.max(0, Math.min(100, value))], { extrapolateRight: "clamp" });
  const r = 200;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 480, height: 480, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={480} height={480} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={240} cy={240} r={r} fill="none" stroke={theme.bgAccent} strokeWidth={30} />
        <circle cx={240} cy={240} r={r} fill="none" stroke={theme.accent} strokeWidth={30} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: theme.fg, fontSize: 120, fontWeight: 800 }}>{Math.round(pct)}%</div>
        <div style={{ color: theme.muted, fontSize: 40 }}>{label}</div>
      </div>
    </div>
  );
}

export function DonutChart({ props, theme, caption }: TemplateProps) {
  return (
    <Shell theme={theme}>
      <Ring value={num(props, "value")} label={str(props, "label", "")} theme={theme} />
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function CircularProgress({ props, theme, caption }: TemplateProps) {
  return (
    <Shell theme={theme}>
      <Ring value={num(props, "value")} label={str(props, "label", "")} theme={theme} />
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// ProgressBars — labelled 0-100 bars.
export function ProgressBars({ props, theme, caption }: TemplateProps) {
  const items = list<{ label: string; value: number }>(props, "items");
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = interpolate(frame, [0, fps], [0, 1], { extrapolateRight: "clamp" });
  return (
    <Shell theme={theme}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 30 }}>
        {items.map((it, i) => {
          const v = Math.max(0, Math.min(100, it.value));
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", color: theme.fg, fontSize: 40, marginBottom: 10 }}>
                <span>{it.label}</span>
                <span style={{ color: theme.accent2 }}>{Math.round(v * grow)}%</span>
              </div>
              <div style={{ height: 30, background: theme.bgAccent, borderRadius: 15, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${v * grow}%`, background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`, borderRadius: 15 }} />
              </div>
            </div>
          );
        })}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// Countdown — 3..2..1 style number swap.
export function Countdown({ props, theme, caption }: TemplateProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const from = Math.max(1, num(props, "from", 3));
  const perStep = durationInFrames / from;
  const idx = Math.min(from - 1, Math.floor(frame / perStep));
  const current = from - idx;
  const local = (frame % perStep) / perStep;
  const scale = interpolate(local, [0, 0.15, 1], [0.6, 1, 0.9]);
  const opacity = interpolate(local, [0, 0.1, 0.85, 1], [0, 1, 1, 0]);
  return (
    <Shell theme={theme}>
      <div style={{ color: theme.accent, fontSize: 400, fontWeight: 800, transform: `scale(${scale})`, opacity }}>
        {current}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// SubscribeReminder — CTA nudge.
export function SubscribeReminder({ props, theme, caption }: TemplateProps) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 120 } });
  const pulse = 1 + Math.sin(frame / 8) * 0.03;
  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center", transform: `scale(${pop * pulse})` }}>
        <div style={{ display: "inline-block", padding: "26px 60px", borderRadius: 999, background: "#ff003c", color: "#fff", fontSize: 60, fontWeight: 800 }}>
          {str(props, "text", "Subscribe")}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export const RVE_TEMPLATE_COMPONENTS: Record<string, React.FC<TemplateProps>> = {
  Typewriter,
  GlitchText,
  LowerThird,
  ChapterTitle,
  CinematicIntro,
  EndCard,
  DonutChart,
  CircularProgress,
  ProgressBars,
  Countdown,
  SubscribeReminder,
};
