// Design packs for b-roll templates. A pack is a full design language — colors,
// typography, backdrop treatment, and motion character — not just a palette.
// The AI planner picks the pack that fits the script's content type; the user
// can override or re-skin instantly.

import { FONTS } from "./fonts";

export type BackdropKind = "grid" | "stripes" | "blobs" | "minimal";
export type TransitionKind = "slide" | "fade";

export interface Theme {
  // colors
  bg: string;
  bgAccent: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  // typography
  font: string; // body
  fontDisplay: string; // headlines
  fontMono: string; // numbers / data
  upper: boolean; // uppercase display type
  tracking: number; // letter-spacing for display type (px)
  displayWeight: number; // headline weight (Anton only ships 400)
  // surface & motion
  radius: number;
  spring: { damping: number; stiffness: number };
  backdrop: BackdropKind;
  transition: TransitionKind; // scene-to-scene transition character
  glow: boolean; // glow behind big numbers/headlines
}

const BODY = "Figtree, system-ui, -apple-system, sans-serif";
const MONO = `${FONTS.jetbrainsMono}, ui-monospace, SFMono-Regular, Menlo, monospace`;

const PACKS: Record<string, Theme> = {
  // Sports, challenges, predictions, anything with energy
  hype: {
    bg: "#07090f",
    bgAccent: "#0d1220",
    fg: "#f8fafc",
    muted: "#7c8598",
    accent: "#22d3ee",
    accent2: "#a3e635",
    font: BODY,
    fontDisplay: `${FONTS.anton}, ${BODY}`,
    fontMono: MONO,
    upper: true,
    tracking: 2,
    displayWeight: 400, // Anton is single-weight
    radius: 10,
    spring: { damping: 11, stiffness: 190 }, // punchy, slight overshoot
    backdrop: "stripes",
    transition: "slide",
    glow: true,
  },
  // AI, data, coding, product/tech explainers
  tech: {
    bg: "#050507",
    bgAccent: "#101014",
    fg: "#fafafa",
    muted: "#8b8b93",
    accent: "#818cf8",
    accent2: "#34d399",
    font: BODY,
    fontDisplay: `${FONTS.spaceGrotesk}, ${BODY}`,
    fontMono: MONO,
    upper: false,
    tracking: 0,
    displayWeight: 700,
    radius: 8,
    spring: { damping: 20, stiffness: 170 }, // precise, no overshoot
    backdrop: "grid",
    transition: "fade",
    glow: true,
  },
  // Education, business, trust, essays
  editorial: {
    bg: "#0c0b09",
    bgAccent: "#161411",
    fg: "#faf7f2",
    muted: "#9a938a",
    accent: "#e8b45a",
    accent2: "#d97757",
    font: BODY,
    fontDisplay: `${FONTS.playfair}, Georgia, serif`,
    fontMono: MONO,
    upper: false,
    tracking: 0,
    displayWeight: 800,
    radius: 4,
    spring: { damping: 26, stiffness: 120 }, // calm, settled
    backdrop: "minimal",
    transition: "fade",
    glow: false,
  },
  // Lifestyle, fitness, food, personal stories
  warm: {
    bg: "#0d0709",
    bgAccent: "#1c1014",
    fg: "#fdf6f8",
    muted: "#a08a91",
    accent: "#fb7185",
    accent2: "#fbbf24",
    font: `${FONTS.nunito}, ${BODY}`,
    fontDisplay: `${FONTS.nunito}, ${BODY}`,
    fontMono: MONO,
    upper: false,
    tracking: 0,
    displayWeight: 800,
    radius: 18,
    spring: { damping: 13, stiffness: 140 }, // soft bounce
    backdrop: "blobs",
    transition: "slide",
    glow: true,
  },
};

// Legacy theme names from previously saved plans.
const LEGACY: Record<string, string> = {
  "dark-modern": "tech",
  "dark-emerald": "hype",
  "dark-amber": "editorial",
  light: "editorial",
};

export function getTheme(name: string): Theme {
  return PACKS[name] || PACKS[LEGACY[name]] || PACKS.tech;
}

export const THEME_NAMES = Object.keys(PACKS);

export const THEME_LABELS: Record<string, string> = {
  hype: "Hype — sports & energy",
  tech: "Tech — AI, data, coding",
  editorial: "Editorial — education & business",
  warm: "Warm — lifestyle & fitness",
};
