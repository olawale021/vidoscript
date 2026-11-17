// Shared between the clip editor (browser), Convex, the worker and the Remotion
// "Clip" composition.

export type ClipAspect = "9:16" | "1:1" | "16:9";
export type CaptionStyle = "bold" | "karaoke" | "clean" | "none";
export type CaptionPosition = "top" | "middle" | "bottom";
// fill = crop to the frame (with face tracking); fit = whole video, bars around it.
export type Framing = "fill" | "fit";
export type FitBackground = "black" | "blur";

// A transcript word. Times are seconds into the source video.
export interface ClipWord {
  w: string;
  s: number;
  e: number;
}

// ── Smart edits ──
// AI-generated edit decisions the user can toggle/tweak. All times are
// seconds into the SOURCE video, so they survive trims.

export type RemovalReason = "silence" | "filler" | "repeat";

export interface SmartRemoval {
  id: string;
  s: number;
  e: number;
  reason: RemovalReason;
  enabled: boolean;
}

export interface SmartZoom {
  id: string;
  t: number; // start
  dur: number;
  scale: number; // e.g. 1.15
  enabled: boolean;
}

export interface SmartHighlight {
  id: string;
  t: number; // start of the word
  word: string;
  color: string;
  emoji?: string | null;
  enabled: boolean;
}

export type AiVideoModel = "kling-3-std" | "wan-2.7" | "seedance-2.0";

export const AI_VIDEO_MODELS: Record<AiVideoModel, { label: string; endpoint: string; minSec: number; maxSec: number }> = {
  "kling-3-std": { label: "Kling 3.0", endpoint: "kling-video/v3.0/std/text-to-video", minSec: 3, maxSec: 15 },
  "wan-2.7": { label: "Wan 2.7", endpoint: "wan/v2.7/text-to-video", minSec: 2, maxSec: 15 },
  "seedance-2.0": { label: "Seedance 2.0", endpoint: "bytedance/seedance-2.0/text-to-video", minSec: 4, maxSec: 15 },
};

// An AI-generated B-roll shot (Higgsfield). The finished video is copied to R2.
export interface AiShot {
  model: AiVideoModel;
  prompt: string;
  status: "generating" | "ready" | "failed";
  requestId?: string | null;
  error?: string | null;
  costUsd?: number | null;
}

export interface SmartBroll {
  id: string;
  t: number;
  dur: number;
  kind: "template" | "stock" | "ai";
  template?: string; // MotionTemplate (types/broll.ts)
  props?: Record<string, unknown>;
  query?: string; // stock search query
  prompt?: string; // AI-written text-to-video prompt for an AI shot (suggested at generation)
  assetUrl?: string | null; // resolved stock video (Pexels links are permanent)
  assetKey?: string | null; // R2 key for an AI shot (signed URL resolved at read time)
  ai?: AiShot | null;
  assetType?: "video" | "image";
  credit?: string | null;
  enabled: boolean;
}

export interface SmartEdit {
  version: 1;
  // track x = face centre as a fraction of the SOURCE width; srcAspect = source width/height.
  reframe: { enabled: boolean; track: { t: number; x: number }[]; srcAspect?: number | null };
  removals: SmartRemoval[];
  zooms: SmartZoom[];
  highlights: SmartHighlight[];
  broll: SmartBroll[];
  hook: { enabled: boolean; text: string; durationSec: number };
  anim: { progressBar: boolean; cutPunch: boolean; endCta: { enabled: boolean; text: string } };
  theme: string; // remotion/theme.ts pack for B-roll templates
}

export function emptySmartEdit(): SmartEdit {
  return {
    version: 1,
    reframe: { enabled: false, track: [] },
    removals: [],
    zooms: [],
    highlights: [],
    broll: [],
    hook: { enabled: false, text: "", durationSec: 2.5 },
    anim: { progressBar: false, cutPunch: true, endCta: { enabled: false, text: "" } },
    theme: "tech",
  };
}

export interface ClipCompositionProps {
  videoUrl: string;
  // Source time at t=0 of videoUrl: 0 when previewing the full source,
  // clip start when rendering a pre-cut segment.
  videoOffsetSec: number;
  start: number; // clip start, source seconds
  end: number; // clip end, source seconds
  aspect: ClipAspect;
  captionStyle: CaptionStyle;
  captionPosition: CaptionPosition;
  cropX: number; // 0..1 manual horizontal focus (used when reframe is off)
  framing: Framing;
  fitBackground: FitBackground;
  // Render-only: a tiny pre-blurred copy of the video (made by the worker with
  // ffmpeg). Much cheaper than blurring full frames in Chrome.
  blurVideoUrl?: string | null;
  words: ClipWord[]; // source seconds, within [start, end]
  smart: SmartEdit | null;
  [key: string]: unknown; // Remotion inputProps are Record<string, unknown>
}

export const CLIP_FPS = 30;

export const CLIP_DIMS: Record<ClipAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const CLIP_DEFAULTS = {
  aspect: "9:16" as ClipAspect,
  captionStyle: "bold" as CaptionStyle,
  captionPosition: "bottom" as CaptionPosition,
  cropX: 0.5,
  framing: "fit" as Framing, // whole video with bars (user preference); "fill" crops + follows the face
  fitBackground: "blur" as FitBackground,
};
