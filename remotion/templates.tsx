import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Theme } from "./theme";

// ── prop readers (shared) ──
export type Props = Record<string, unknown>;
export const str = (p: Props, k: string, d = ""): string =>
  typeof p[k] === "string" ? (p[k] as string) : d;
export const num = (p: Props, k: string, d = 0): number =>
  typeof p[k] === "number" ? (p[k] as number) : d;
export const list = <T,>(p: Props, k: string): T[] =>
  Array.isArray(p[k]) ? (p[k] as T[]) : [];

export interface TemplateProps {
  props: Props;
  theme: Theme;
  caption?: string | null;
  query?: string;
  assetRef?: string;
  assetType?: "video" | "image";
}

// ── motion ──
export function useEnter(delay = 0, spr?: { damping: number; stiffness: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: spr ?? { damping: 200 },
    durationInFrames: 24,
  });
}

// Display-type styling from the pack (headlines). Spread LAST so the pack's
// weight wins (Anton only ships 400 — synthesized bold looks broken).
function display(theme: Theme): React.CSSProperties {
  return {
    fontFamily: theme.fontDisplay,
    fontWeight: theme.displayWeight,
    textTransform: theme.upper ? "uppercase" : "none",
    letterSpacing: theme.upper ? theme.tracking : 0,
  };
}

// ── backdrops (frame-driven, subtle) ──
function Backdrop({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 20;

  if (theme.backdrop === "grid") {
    return (
      <AbsoluteFill>
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${theme.fg}0a 1px, transparent 1px), linear-gradient(90deg, ${theme.fg}0a 1px, transparent 1px)`,
            backgroundSize: "72px 72px",
            backgroundPosition: `${drift}px 0`,
          }}
        />
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 90% 55% at 50% -10%, ${theme.accent}26, transparent 60%)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (theme.backdrop === "stripes") {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: "-20%",
            left: "-30%",
            width: "160%",
            height: "38%",
            background: `linear-gradient(90deg, transparent, ${theme.accent}14, transparent)`,
            transform: `rotate(-14deg) translateX(${drift * 3}px)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-15%",
            left: "-30%",
            width: "160%",
            height: "30%",
            background: `linear-gradient(90deg, transparent, ${theme.accent2}10, transparent)`,
            transform: `rotate(-14deg) translateX(${-drift * 3}px)`,
          }}
        />
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse 80% 50% at 50% 110%, ${theme.accent}1f, transparent 65%)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  if (theme.backdrop === "blobs") {
    return (
      <AbsoluteFill style={{ overflow: "hidden", filter: "blur(70px)" }}>
        <div
          style={{
            position: "absolute",
            top: "8%",
            left: "-15%",
            width: 500,
            height: 500,
            borderRadius: 9999,
            background: `${theme.accent}2e`,
            transform: `translateY(${drift}px)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "5%",
            right: "-18%",
            width: 560,
            height: 560,
            borderRadius: 9999,
            background: `${theme.accent2}24`,
            transform: `translateY(${-drift}px)`,
          }}
        />
      </AbsoluteFill>
    );
  }

  // minimal
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 100% 60% at 50% 0%, ${theme.fg}08, transparent 60%)`,
      }}
    />
  );
}

export function Caption({ text, theme }: { text?: string | null; theme: Theme }) {
  const e = useEnter(8, theme.spring);
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 84,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: e,
        transform: `translateY(${(1 - e) * 18}px)`,
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          textAlign: "center",
          color: theme.fg,
          fontFamily: theme.font,
          fontSize: 38,
          fontWeight: 600,
          lineHeight: 1.25,
          padding: "14px 28px",
          borderRadius: theme.radius + 8,
          background: `${theme.bg}b8`,
          border: `1px solid ${theme.fg}14`,
          backdropFilter: "blur(12px)",
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function Shell({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(165deg, ${theme.bg}, ${theme.bgAccent})`,
        fontFamily: theme.font,
      }}
    >
      <Backdrop theme={theme} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
        {children}
      </AbsoluteFill>
      {/* vignette for depth */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: `radial-gradient(ellipse 130% 100% at 50% 50%, transparent 60%, ${theme.bg}99 100%)`,
        }}
      />
    </AbsoluteFill>
  );
}

// ── templates ──

export function TitleCard({ props, theme, caption }: TemplateProps) {
  const e = useEnter(0, theme.spring);
  const e2 = useEnter(8, theme.spring);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bar = interpolate(frame, [10, 10 + fps * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center", maxWidth: "88%" }}>
        {str(props, "kicker") && (
          <div
            style={{
              display: "inline-block",
              color: theme.accent,
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              padding: "8px 22px",
              border: `1.5px solid ${theme.accent}55`,
              borderRadius: 999,
              marginBottom: 28,
              opacity: e,
            }}
          >
            {str(props, "kicker")}
          </div>
        )}
        <div
          style={{
            color: theme.fg,
            fontSize: 96,
            lineHeight: 1.06,
            ...display(theme),
            opacity: e,
            transform: `translateY(${(1 - e) * 34}px) scale(${0.96 + e * 0.04})`,
            textShadow: theme.glow ? `0 0 80px ${theme.accent}40` : undefined,
          }}
        >
          {str(props, "title", "Title")}
        </div>
        {/* accent underline draws in */}
        <div
          style={{
            height: 6,
            width: `${bar * 180}px`,
            margin: "26px auto 0",
            borderRadius: 3,
            background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
          }}
        />
        {str(props, "subtitle") && (
          <div style={{ color: theme.muted, fontSize: 42, marginTop: 26, opacity: e2 }}>
            {str(props, "subtitle")}
          </div>
        )}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function BigStat({ props, theme, caption }: TemplateProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const target = num(props, "value");
  const from = num(props, "from", 0);
  const progress = interpolate(frame, [4, 4 + fps * 1.1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const current = from + (target - from) * progress;
  const displayVal = Number.isInteger(target) ? Math.round(current).toLocaleString() : current.toFixed(1);
  const e = useEnter(0, theme.spring);
  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center", position: "relative" }}>
        {/* glow disc behind the number */}
        {theme.glow && (
          <div
            style={{
              position: "absolute",
              inset: "-60px -100px",
              background: `radial-gradient(circle, ${theme.accent}2e, transparent 65%)`,
              filter: "blur(10px)",
            }}
          />
        )}
        <div
          style={{
            position: "relative",
            color: theme.accent,
            fontFamily: theme.fontMono,
            fontSize: 190,
            fontWeight: 800,
            lineHeight: 1,
            opacity: e,
            transform: `scale(${0.85 + e * 0.15})`,
            textShadow: theme.glow ? `0 0 60px ${theme.accent}66` : undefined,
          }}
        >
          {str(props, "prefix")}
          {displayVal}
          {str(props, "suffix")}
        </div>
        <div
          style={{
            position: "relative",
            color: theme.fg,
            fontSize: 50,
            marginTop: 26,
            ...display(theme),
            opacity: e,
          }}
        >
          {str(props, "label", "")}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function Timeline({ props, theme, caption }: TemplateProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = num(props, "start");
  const end = num(props, "end", start + 1);
  const markers = list<{ at: number; label: string }>(props, "markers");
  const fill = interpolate(frame, [6, 6 + fps * 1.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const e = useEnter(0, theme.spring);
  return (
    <Shell theme={theme}>
      <div style={{ width: "100%", opacity: e }}>
        <div
          style={{
            color: theme.fg,
            fontSize: 58,
            marginBottom: 64,
            textAlign: "center",
            ...display(theme),
          }}
        >
          {str(props, "label", "")}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: theme.muted,
            fontFamily: theme.fontMono,
            fontSize: 40,
            marginBottom: 18,
          }}
        >
          <span>{start}</span>
          <span style={{ color: theme.accent2 }}>{end}</span>
        </div>
        <div
          style={{
            position: "relative",
            height: 16,
            background: `${theme.fg}12`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${fill * 100}%`,
              borderRadius: 8,
              background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
              boxShadow: theme.glow ? `0 0 26px ${theme.accent}88` : undefined,
            }}
          />
          {/* moving head */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: `${fill * 100}%`,
              transform: "translate(-50%, -50%)",
              width: 30,
              height: 30,
              borderRadius: 15,
              background: theme.fg,
              boxShadow: `0 0 20px ${theme.accent}`,
            }}
          />
        </div>
        {markers.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
            {markers.map((m, i) => (
              <span key={i} style={{ color: theme.accent2, fontSize: 32, fontWeight: 600 }}>
                {m.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function Comparison({ props, theme, caption }: TemplateProps) {
  const left = (props.left as { label?: string; value?: string | number }) || {};
  const right = (props.right as { label?: string; value?: string | number }) || {};
  const eL = useEnter(0, theme.spring);
  const eR = useEnter(7, theme.spring);
  const eVs = useEnter(14, theme.spring);
  const Side = ({
    side,
    e,
    dir,
    color,
  }: {
    side: { label?: string; value?: string | number };
    e: number;
    dir: number;
    color: string;
  }) => (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        padding: "44px 20px",
        borderRadius: theme.radius + 6,
        background: `${theme.fg}07`,
        border: `1px solid ${theme.fg}12`,
        opacity: e,
        transform: `translateX(${(1 - e) * dir * 46}px)`,
      }}
    >
      <div
        style={{
          color,
          fontFamily: theme.fontMono,
          fontSize: 104,
          fontWeight: 800,
          textShadow: theme.glow ? `0 0 46px ${color}55` : undefined,
        }}
      >
        {String(side.value ?? "")}
      </div>
      <div style={{ color: theme.fg, fontSize: 40, marginTop: 14, ...display(theme) }}>
        {side.label ?? ""}
      </div>
    </div>
  );
  return (
    <Shell theme={theme}>
      <div style={{ width: "100%" }}>
        {str(props, "metric") && (
          <div
            style={{
              textAlign: "center",
              color: theme.muted,
              fontSize: 38,
              marginBottom: 46,
              textTransform: "uppercase",
              letterSpacing: 3,
            }}
          >
            {str(props, "metric")}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Side side={left} e={eL} dir={-1} color={theme.accent} />
          <div
            style={{
              width: 78,
              height: 78,
              borderRadius: 39,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: theme.fg,
              color: theme.bg,
              fontSize: 34,
              fontWeight: 800,
              opacity: eVs,
              transform: `scale(${eVs})`,
            }}
          >
            VS
          </div>
          <Side side={right} e={eR} dir={1} color={theme.accent2} />
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function Pipeline({ props, theme, caption }: TemplateProps) {
  const steps = list<string>(props, "steps");
  const active = num(props, "activeStep", 0);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = interpolate(frame, [8, 8 + fps * 0.9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Shell theme={theme}>
      <div style={{ width: "100%", position: "relative" }}>
        {/* connector line draws down */}
        <div
          style={{
            position: "absolute",
            left: 38,
            top: 40,
            bottom: 40,
            width: 3,
            background: `${theme.fg}10`,
          }}
        >
          <div
            style={{
              width: "100%",
              height: `${line * 100}%`,
              background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})`,
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 34, position: "relative" }}>
          {steps.map((step, i) => {
            const e = useEnter(i * 6, theme.spring);
            const isActive = active === i + 1;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 30,
                  opacity: e,
                  transform: `translateX(${(1 - e) * -34}px)`,
                }}
              >
                <div
                  style={{
                    width: 78,
                    height: 78,
                    borderRadius: 39,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: theme.fontMono,
                    fontSize: 38,
                    fontWeight: 800,
                    color: isActive ? theme.bg : theme.fg,
                    background: isActive ? theme.accent : theme.bgAccent,
                    border: `2px solid ${isActive ? theme.accent : `${theme.fg}22`}`,
                    boxShadow: isActive && theme.glow ? `0 0 34px ${theme.accent}77` : undefined,
                  }}
                >
                  {i + 1}
                </div>
                <div
                  style={{
                    color: isActive ? theme.fg : theme.muted,
                    fontSize: 46,
                    fontWeight: isActive ? 700 : 500,
                    lineHeight: 1.2,
                  }}
                >
                  {step}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function BulletList({ props, theme, caption }: TemplateProps) {
  const items = list<string>(props, "items");
  return (
    <Shell theme={theme}>
      <div style={{ width: "100%" }}>
        {str(props, "title") && (
          <div style={{ color: theme.fg, fontSize: 62, marginBottom: 52, ...display(theme) }}>
            {str(props, "title")}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {items.map((item, i) => {
            const e = useEnter(i * 7, theme.spring);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  padding: "22px 26px",
                  borderRadius: theme.radius + 4,
                  background: `${theme.fg}07`,
                  border: `1px solid ${theme.fg}10`,
                  opacity: e,
                  transform: `translateX(${(1 - e) * -34}px)`,
                }}
              >
                <div
                  style={{
                    width: 14,
                    height: 34,
                    borderRadius: 7,
                    background: `linear-gradient(180deg, ${theme.accent}, ${theme.accent2})`,
                    flexShrink: 0,
                  }}
                />
                <div style={{ color: theme.fg, fontSize: 46, fontWeight: 500, lineHeight: 1.25 }}>{item}</div>
              </div>
            );
          })}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function Quote({ props, theme, caption }: TemplateProps) {
  const e = useEnter(0, theme.spring);
  return (
    <Shell theme={theme}>
      <div
        style={{
          textAlign: "center",
          maxWidth: "86%",
          opacity: e,
          transform: `translateY(${(1 - e) * 22}px)`,
        }}
      >
        <div style={{ color: theme.accent, fontFamily: "Georgia, serif", fontSize: 170, lineHeight: 0.4, height: 70 }}>
          &ldquo;
        </div>
        <div
          style={{
            color: theme.fg,
            fontFamily: theme.fontDisplay,
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.28,
          }}
        >
          {str(props, "quote", "")}
        </div>
        {str(props, "attribution") && (
          <div style={{ color: theme.muted, fontSize: 38, marginTop: 38 }}>— {str(props, "attribution")}</div>
        )}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function Reveal({ props, theme, caption }: TemplateProps) {
  const lines = list<string>(props, "lines");
  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center", maxWidth: "90%" }}>
        {lines.map((line, i) => {
          const e = useEnter(i * 9, theme.spring);
          const isAccent = i % 2 === 1;
          return (
            <div
              key={i}
              style={{
                color: isAccent ? theme.accent : theme.fg,
                fontSize: 92,
                lineHeight: 1.12,
                ...display(theme),
                opacity: e,
                transform: `translateY(${(1 - e) * 30}px)`,
                textShadow: isAccent && theme.glow ? `0 0 60px ${theme.accent}55` : undefined,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export function Chart({ props, theme, caption }: TemplateProps) {
  const data = list<{ label: string; value: number }>(props, "data");
  const max = Math.max(1, ...data.map((d) => d.value));
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Shell theme={theme}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 30 }}>
        {data.map((d, i) => {
          const grow = interpolate(frame, [6 + i * 5, 6 + i * 5 + fps * 0.8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: theme.fg,
                  fontSize: 38,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontWeight: 600 }}>{d.label}</span>
                <span style={{ color: theme.accent2, fontFamily: theme.fontMono, fontWeight: 700 }}>
                  {Math.round(d.value * grow)}
                  {str(props, "unit")}
                </span>
              </div>
              <div style={{ height: 42, background: `${theme.fg}0d`, borderRadius: theme.radius, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(d.value / max) * 100 * grow}%`,
                    background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`,
                    borderRadius: theme.radius,
                    boxShadow: theme.glow ? `0 0 24px ${theme.accent}66` : undefined,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

// Footage — real Pexels stock (video or image) when resolved, gentle ken-burns.
// Falls back to a labelled placeholder when no asset is resolved.
export function Footage({ theme, caption, query, assetRef, assetType }: TemplateProps) {
  const frame = useCurrentFrame();
  const scale = 1 + (frame / 300) * 0.08;

  if (assetRef) {
    return (
      <AbsoluteFill style={{ overflow: "hidden", background: theme.bg }}>
        <AbsoluteFill style={{ transform: `scale(${scale})` }}>
          {assetType === "image" ? (
            <Img src={assetRef} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <OffthreadVideo src={assetRef} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          )}
        </AbsoluteFill>
        <AbsoluteFill
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent 45%)" }}
        />
        <Caption text={caption} theme={theme} />
      </AbsoluteFill>
    );
  }

  return (
    <Shell theme={theme}>
      <div style={{ textAlign: "center", fontFamily: theme.font }}>
        <div style={{ color: theme.muted, fontSize: 30, letterSpacing: 3, textTransform: "uppercase" }}>
          Stock footage
        </div>
        <div style={{ color: theme.fg, fontSize: 46, fontWeight: 600, marginTop: 16, maxWidth: 700, opacity: 0.7 }}>
          {query || "footage"}
        </div>
      </div>
      <Caption text={caption} theme={theme} />
    </Shell>
  );
}

export const NATIVE_TEMPLATE_COMPONENTS: Record<string, React.FC<TemplateProps>> = {
  TitleCard,
  BigStat,
  Timeline,
  Comparison,
  Pipeline,
  BulletList,
  Quote,
  Reveal,
  Chart,
  Footage,
};
