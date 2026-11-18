// Story Studio: AI story videos made from an idea (script → plan → cast →
// storyboard → export). Phase 1 = stills with pan/zoom motion + voiceover.

import type { CaptionStyle } from "./clip";

export type StoryAspect = "9:16" | "16:9";
export type StoryStep = "script" | "plan" | "cast" | "board" | "export";
export type CameraMove = "push_in" | "pull_out" | "pan_left" | "pan_right" | "static";
export type ItemStatus = "none" | "queued" | "working" | "ready" | "failed";
export type StoryJobKind = "script" | "line" | "piece" | "plan" | "ref" | "still" | "voice" | "video" | "render";

export const STORY_STEPS: { id: StoryStep; label: string }[] = [
  { id: "script", label: "Script" },
  { id: "plan", label: "Plan" },
  { id: "cast", label: "Cast" },
  { id: "board", label: "Storyboard" },
  { id: "export", label: "Export" },
];

export const CAMERA_MOVES: { id: CameraMove; label: string }[] = [
  { id: "push_in", label: "Push in" },
  { id: "pull_out", label: "Pull out" },
  { id: "pan_left", label: "Pan left" },
  { id: "pan_right", label: "Pan right" },
  { id: "static", label: "Still" },
];

export const STORY_STYLES: Record<string, { label: string; prompt: string }> = {
  cinematic: {
    label: "Cinematic",
    prompt: "cinematic film still, dramatic natural lighting, rich colour grade, shallow depth of field, 35mm film look",
  },
  anime: {
    label: "Anime",
    prompt: "high-quality anime illustration, clean line art, cel shading, vibrant colours, detailed painted backgrounds",
  },
  cartoon3d: {
    label: "3D cartoon",
    prompt: "3D animated feature film style, soft global illumination, expressive stylised characters, polished render",
  },
  watercolor: {
    label: "Watercolor",
    prompt: "storybook watercolor painting, soft washes, visible paper texture, gentle muted palette",
  },
  comic: {
    label: "Comic",
    prompt: "graphic novel art, bold ink outlines, halftone shading, strong dramatic colours",
  },
  photo: {
    label: "Realistic photo",
    prompt: "photorealistic photograph, natural light, realistic skin and materials, documentary feel",
  },
};

// OpenAI gpt-4o-mini-tts voices.
export const STORY_VOICES: { id: string; label: string }[] = [
  { id: "onyx", label: "Onyx · deep male" },
  { id: "ash", label: "Ash · warm male" },
  { id: "echo", label: "Echo · calm male" },
  { id: "fable", label: "Fable · storyteller" },
  { id: "verse", label: "Verse · expressive" },
  { id: "nova", label: "Nova · bright female" },
  { id: "coral", label: "Coral · warm female" },
  { id: "shimmer", label: "Shimmer · soft female" },
  { id: "sage", label: "Sage · gentle" },
  { id: "ballad", label: "Ballad · emotive" },
  { id: "alloy", label: "Alloy · neutral" },
];
export const VOICE_IDS = STORY_VOICES.map((v) => v.id);

export const STORY_LENGTHS = [30, 60, 90, 180];

export interface StoryCharacter {
  id: string;
  name: string;
  look: string; // fixed visual description (age, hair, clothes, colours)
  voice: string;
  refKey?: string | null;
  refStatus: ItemStatus;
  refError?: string | null;
}

export interface StoryLocation {
  id: string;
  name: string;
  look: string;
  refKey?: string | null;
  refStatus: ItemStatus;
  refError?: string | null;
}

export interface StoryBible {
  characters: StoryCharacter[];
  locations: StoryLocation[];
}

export type StoryWord = { w: string; s: number; e: number };

// ── Remotion composition ──

export const STORY_FPS = 30;
export const STORY_FADE_FRAMES = 10;
export const STORY_DIMS: Record<StoryAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

export type StoryShotInput = {
  imageUrl: string;
  videoUrl?: string | null; // Phase 2: AI video clip (starts from the still)
  videoSec?: number | null;
  lipSync?: boolean; // talking clip: play at normal speed (lips match the voice), then hold the last frame
  audioUrl: string | null;
  durationSec: number;
  camera: CameraMove;
  words: StoryWord[];
};

// A type alias (not an interface) so it satisfies Remotion's Record<string, unknown> props.
export type StoryCompositionProps = {
  shots: StoryShotInput[];
  aspect: StoryAspect;
  captionStyle: CaptionStyle;
  hook: string | null;
  musicUrl?: string | null;
  musicVolume?: number;
};

export const shotFrames = (durationSec: number) => Math.max(1, Math.round(durationSec * STORY_FPS));

export const storyDurationInFrames = (p: Pick<StoryCompositionProps, "shots">) =>
  Math.max(1, p.shots.reduce((sum, s) => sum + shotFrames(s.durationSec), 0));

// ── Feedback (the AI learns the creator's taste from these) ──

export type FeedbackStage = "script" | "plan" | "still" | "motion" | "voice" | "video";

export const FEEDBACK_REASONS: Record<FeedbackStage, { up: string[]; down: string[] }> = {
  script: {
    up: ["Great hook", "Good twist", "Emotional", "Funny", "Good pacing"],
    down: ["Weak hook", "Boring", "Confusing", "Too slow", "Cringe", "Predictable ending"],
  },
  plan: {
    up: ["Good shot choices", "Good pacing"],
    down: ["Too many shots", "Too few shots", "Repetitive camera", "Missing key moments"],
  },
  still: {
    up: ["Love it", "Great composition", "On style"],
    down: ["Wrong character look", "Wrong setting", "Off style", "Bad anatomy", "Text in image", "Too dark", "Boring framing"],
  },
  motion: {
    up: ["Great motion", "Natural movement"],
    down: ["Weird movement", "Character changed", "Too static", "Wrong action", "Glitchy"],
  },
  voice: {
    up: ["Great delivery"],
    down: ["Too fast", "Too slow", "Flat / no emotion", "Wrong voice", "Mispronounced"],
  },
  video: {
    up: ["Would post it", "Great story", "Great visuals"],
    down: ["Story didn't land", "Visuals inconsistent", "Voice off", "Too long"],
  },
};

// ── Phase 2: AI video per shot (Higgsfield image-to-video, 720p) ──

export type StoryVideoModel = "kling-3-std" | "wan-2.6" | "seedance-2.0" | "kling-avatar";

export const STORY_VIDEO_MODELS: Record<
  StoryVideoModel,
  {
    label: string;
    endpoint: string;
    perSec: number;
    durations: number[] | { min: number; max: number };
    note: string;
    provider?: "fal"; // default: Higgsfield
    talking?: boolean; // lips follow the shot's voice (picture + audio → video)
  }
> = {
  "kling-3-std": {
    label: "Kling 3.0",
    endpoint: "kling-video/v3.0/std/image-to-video",
    perSec: 0.0714,
    durations: { min: 3, max: 15 },
    note: "Good motion, best value",
  },
  "wan-2.6": {
    label: "Wan 2.6",
    endpoint: "wan/v2.6/image-to-video",
    perSec: 0.075,
    durations: [5, 10, 15],
    note: "Similar quality, clips of 5, 10 or 15 s",
  },
  "seedance-2.0": {
    label: "Seedance 2.0",
    endpoint: "bytedance/seedance-2.0/image-to-video",
    perSec: 0.1735,
    durations: { min: 4, max: 15 },
    note: "Best quality, about 2.4× the price",
  },
  // Talking shots: Kling AI Avatar v2 Standard on fal.ai. The character's lips
  // follow the shot's voice line; the clip is as long as the voice.
  "kling-avatar": {
    label: "Talking (Kling Avatar)",
    endpoint: "fal-ai/kling-video/ai-avatar/v2/standard",
    perSec: 0.0562,
    durations: { min: 1, max: 60 },
    note: "The character says the line, lips in sync",
    provider: "fal",
    talking: true,
  },
};
export const VIDEO_MODEL_IDS = Object.keys(STORY_VIDEO_MODELS) as StoryVideoModel[];
// "Animate all" models (motion only); talking is chosen per shot.
export const MOTION_MODEL_IDS = VIDEO_MODEL_IDS.filter((id) => !STORY_VIDEO_MODELS[id].talking);
export const TALKING_MODEL: StoryVideoModel = "kling-avatar";
export const isTalking = (model?: string | null) => !!model && !!STORY_VIDEO_MODELS[model as StoryVideoModel]?.talking;

// Clip length for a shot: at least the shot's length, snapped to what the model allows.
export function videoDurationFor(model: StoryVideoModel, shotSec: number) {
  const d = STORY_VIDEO_MODELS[model].durations;
  // Talking clips follow the voice (shotSec includes a short pause after it).
  if (STORY_VIDEO_MODELS[model].talking) return Math.max(1, Math.round((shotSec - 0.35) * 10) / 10);
  const need = Math.ceil(shotSec);
  if (Array.isArray(d)) return d.find((x) => x >= need) ?? d[d.length - 1];
  return Math.max(d.min, Math.min(d.max, need));
}

export const shotSeconds = (audioSec: number | null | undefined) => Math.max(1.5, (audioSec ?? 3) + 0.35);

// ── Phase 3b: background music (public-domain / CC0 recordings from
// Wikimedia Commons, mostly Musopen). Files live in R2 at MUSIC_KEY(id):
// trimmed to ≤ 4 min, levelled to −20 LUFS. No attribution required.

export type MusicMood = "calm" | "emotional" | "uplifting" | "playful" | "tense" | "mysterious" | "epic";
export const MUSIC_MOODS: MusicMood[] = ["calm", "emotional", "uplifting", "playful", "tense", "mysterious", "epic"];

export const STORY_MUSIC: { id: string; title: string; mood: MusicMood; license: string; source: string }[] = [
  { id: "calm-aria", title: "Goldberg Aria (Bach)", mood: "calm", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Bach,_Goldberg_Variations,_Aria_(Musopen_version).ogg" },
  { id: "calm-morning", title: "Morning Mood (Grieg)", mood: "calm", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Grieg_-_Peer_Gynt_Suite_No._1,_Op._46_-_I._Morning_Mood_(Musopen_Symphony).flac" },
  { id: "emotional-largo", title: "New World Largo (Dvo\u0159\u00e1k)", mood: "emotional", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Antonin_Dvorak_-_symphony_no._9_in_e_minor_%27from_the_new_world%27,_op._95_-_ii._largo.ogg" },
  { id: "emotional-moonlight", title: "Moonlight Sonata (Beethoven)", mood: "emotional", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Ludwig_van_Beethoven_-_sonata_no._14_in_c_sharp_minor_%27moonlight%27,_op._27_no._2_-_i._adagio_sostenuto.ogg" },
  { id: "emotional-nocturne", title: "Nocturne Op. 9 No. 2 (Chopin)", mood: "emotional", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Chopin_Nocturne_No._2_in_E_Flat_Major,_Op._9.ogg" },
  { id: "uplifting-carnival", title: "Carnival Overture (Dvo\u0159\u00e1k)", mood: "uplifting", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Antonin_Dvorak_-_carnival_overture,_op._92.ogg" },
  { id: "uplifting-vivaldi", title: "Mandolin Concerto (Vivaldi)", mood: "uplifting", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Antonio_Vivaldi,_Mandolin_Concerto_in_C_major,_RV_425.ogg" },
  { id: "playful-badinerie", title: "Badinerie (Bach)", mood: "playful", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Bach,_Johann_Sebastian_-_Suite_No.2_in_B_Minor_-_X._Badinerie.ogg" },
  { id: "playful-clowns", title: "Dance of the Clowns (Mendelssohn)", mood: "playful", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:A_Midsummer_Night%27s_Dream_Op._61_Dance_of_Clowns_(Mendelssohn)_European_Archive.ogg" },
  { id: "tense-baba-yaga", title: "The Hut on Hen's Legs (Mussorgsky)", mood: "tense", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Modest_Mussorgsky_-_pictures_at_an_exhibition_-_ix._la_cabane_sur_des_pattes_de_poule_-_allegro_con_brio,_feroce_-_andante_mosso_-_allegro_molto.ogg" },
  { id: "tense-bald-mountain", title: "Night on Bald Mountain (Mussorgsky)", mood: "tense", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Modest_Mussorgsky_-_night_on_bald_mountain.ogg" },
  { id: "tense-mountain-king", title: "Hall of the Mountain King (Grieg)", mood: "tense", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Grieg_-_Peer_Gynt_Suite_No._1,_Op._46_-_IV._In_the_Hall_of_the_Mountain_King_(Musopen_Symphony).flac" },
  { id: "mysterious-castle", title: "The Old Castle (Mussorgsky)", mood: "mysterious", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Modest_Mussorgsky_-_pictures_at_an_exhibition_-_ii._il_vecchio_castello_-_andante.ogg" },
  { id: "mysterious-scriabin", title: "Prelude Op. 67 (Scriabin)", mood: "mysterious", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Alexander_Scriabin_-_prelude_no._1,_op._67.ogg" },
  { id: "epic-moldau", title: "The Moldau (Smetana)", mood: "epic", license: "Public domain", source: "https://commons.wikimedia.org/wiki/File:Bedrich_Smetana_-_ma_vlast_-_i._vltava_%27the_moldau%27.ogg" },
];

export const MUSIC_KEY = (id: string) => `shared/music/${id}.mp3`;
export const DEFAULT_MUSIC_VOLUME = 0.12;

// Which AI writes text (script, line rewrites, plan, plan rewrites).
export type TextAi = "openai" | "gemini";
export const TEXT_AIS: { id: TextAi; label: string; note: string }[] = [
  { id: "openai", label: "OpenAI GPT-5.5", note: "Best writing, about $0.05–0.10 a script" },
  { id: "gemini", label: "Gemini 2.5 Flash", note: "Fast and very cheap, under a cent" },
];
