// ScenePlan contract — the interface between the AI planner (script side) and the
// Remotion renderer (render side). See docs/broll/SCENE_PLAN.md.

export type SceneKind = "motion" | "footage";

export type MotionTemplate =
  // native
  | "TitleCard"
  | "BigStat"
  | "Timeline"
  | "Comparison"
  | "Pipeline"
  | "BulletList"
  | "Quote"
  | "Reveal"
  | "Chart"
  // RVE-adapted
  | "Typewriter"
  | "GlitchText"
  | "LowerThird"
  | "ChapterTitle"
  | "CinematicIntro"
  | "EndCard"
  | "DonutChart"
  | "CircularProgress"
  | "ProgressBars"
  | "Countdown"
  | "SubscribeReminder";

export type Template = MotionTemplate | "Footage";

export type Aspect = "9:16" | "16:9" | "1:1";

export interface Scene {
  id: string;
  kind: SceneKind;
  template: Template;
  props: Record<string, unknown>;
  caption?: string | null;
  query?: string; // footage only: stock search query
  assetRef?: string; // footage only: resolved media URL
  assetType?: "video" | "image"; // footage only
  assetCredit?: string; // footage only: attribution
  durationSec: number;
  needsInput?: boolean; // planner could not fill required data
  sourceBeat?: string; // "HOOK" | "POINT 2" | "CTA" | ...
}

export interface ScenePlan {
  version: 1;
  theme: string;
  aspect: Aspect;
  scenes: Scene[];
}

export const MOTION_TEMPLATES: MotionTemplate[] = [
  "TitleCard",
  "BigStat",
  "Timeline",
  "Comparison",
  "Pipeline",
  "BulletList",
  "Quote",
  "Reveal",
  "Chart",
  "Typewriter",
  "GlitchText",
  "LowerThird",
  "ChapterTitle",
  "CinematicIntro",
  "EndCard",
  "DonutChart",
  "CircularProgress",
  "ProgressBars",
  "Countdown",
  "SubscribeReminder",
];

export const ALL_TEMPLATES: Template[] = [...MOTION_TEMPLATES, "Footage"];

export const ASPECTS: Aspect[] = ["9:16", "16:9", "1:1"];

// Required prop keys per template (used for validation).
export const REQUIRED_PROPS: Record<Template, string[]> = {
  TitleCard: ["title"],
  BigStat: ["value", "label"],
  Timeline: ["start", "end", "label"],
  Comparison: ["left", "right"],
  Pipeline: ["steps"],
  BulletList: ["items"],
  Quote: ["quote"],
  Reveal: ["lines"],
  Chart: ["data", "chartType"],
  Footage: [], // uses query/assetRef, checked separately
  // RVE-adapted
  Typewriter: ["text"],
  GlitchText: ["text"],
  LowerThird: ["title"],
  ChapterTitle: ["title"],
  CinematicIntro: ["title"],
  EndCard: ["title"],
  DonutChart: ["value", "label"],
  CircularProgress: ["value", "label"],
  ProgressBars: ["items"],
  Countdown: ["from"],
  SubscribeReminder: [],
};

export const DURATION_MIN = 1;
export const DURATION_MAX = 15;
export const MAX_SCENES = 12;
