// Shared b-roll planner logic: the prompt the LLM sees and the validator that
// guards its output. Both providers (gemini/openai) import from here so the
// template catalog lives in exactly one place. See docs/broll/SCENE_PLAN.md.

import {
  ALL_TEMPLATES,
  ASPECTS,
  Aspect,
  DURATION_MAX,
  DURATION_MIN,
  MAX_SCENES,
  REQUIRED_PROPS,
  Scene,
  ScenePlan,
  Template,
} from "@/types/broll";

export interface PlannerAnalysis {
  structure?: { intro?: string; body?: string[]; cta?: string };
  themes?: string[];
  tone?: string;
}

export interface PlannerOptions {
  theme?: string;
  aspect?: Aspect;
}

const CATALOG_DESCRIPTION = `AVAILABLE TEMPLATES (you may ONLY use these):

MOTION templates (kind: "motion") — code-driven graphics, the majority of scenes:
- TitleCard   props: { title: string, subtitle?: string, kicker?: string }
- BigStat     props: { value: number, label: string, prefix?: string, suffix?: string, from?: number }
- Timeline    props: { start: number, end: number, label: string, markers?: {at:number,label:string}[] }
- Comparison  props: { left: {label:string,value:string|number}, right: {label:string,value:string|number}, metric?: string }
- Pipeline    props: { steps: string[], activeStep?: number }
- BulletList  props: { items: string[] (2-5), title?: string }
- Quote       props: { quote: string, attribution?: string }
- Reveal      props: { lines: string[] (1-4 short phrases) }
- Chart       props: { data: {label:string,value:number}[], chartType: "bar"|"line", unit?: string }
- Typewriter  props: { text: string }   // types a line out, good for a punchy sentence
- GlitchText  props: { text: string }   // punchy word/phrase with a glitch settle
- LowerThird  props: { title: string, subtitle?: string }   // name/label bar
- ChapterTitle props: { title: string, chapter?: string|number }   // section divider
- CinematicIntro props: { title: string, subtitle?: string }   // dramatic letterboxed opener
- EndCard     props: { title: string, cta?: string }   // outro
- DonutChart  props: { value: number (0-100), label: string }   // single percentage
- CircularProgress props: { value: number (0-100), label: string }
- ProgressBars props: { items: {label:string,value:number (0-100)}[] }
- Countdown   props: { from: number }   // e.g. 3 -> 3..2..1
- SubscribeReminder props: { text?: string }   // CTA nudge

FOOTAGE template (kind: "footage") — stock clip under a caption, for atmospheric
beats with no data. Aim for roughly 30% of scenes to be footage:
- Footage     props: { kenBurns?: boolean }   REQUIRES a "query" field (a stock search phrase)`;

export function plannerSystemPrompt(): string {
  return `You are a motion-graphics director. You turn a short spoken-style video script into a b-roll SCENE PLAN: an ordered list of visual scenes, one per beat of the script.

${CATALOG_DESCRIPTION}

MAPPING HEURISTICS:
- A beat with a NUMBER -> BigStat (or Chart if several comparable numbers).
- A beat comparing TWO things -> Comparison.
- A beat describing STEPS/a process -> Pipeline.
- A beat that is a LIST -> BulletList.
- A YEAR or time RANGE -> Timeline.
- The opening [HOOK] -> TitleCard or Reveal (grab attention).
- The [CTA] -> TitleCard or Reveal (call to action).
- Narrative/atmospheric filler with no data -> Footage (with a "query"). ~30% of scenes.

HARD RULES:
1. Use ONLY templates from the catalog, with their exact required props.
2. NEVER invent statistics. If a BigStat/Chart/Comparison needs a number that is
   not in the script, set "needsInput": true and use a placeholder value.
3. Every scene needs a "durationSec" between ${DURATION_MIN} and ${DURATION_MAX}.
4. Every "footage" scene MUST include a non-empty "query".
5. Produce at most ${MAX_SCENES} scenes. Keep scene order = script order.
6. Give each scene a unique short "id" ("s1", "s2", ...) and a "sourceBeat"
   ("HOOK", "POINT 1", "CTA", ...).

OUTPUT: Return ONLY valid JSON matching:
{
  "version": 1,
  "theme": string,
  "aspect": "9:16" | "16:9" | "1:1",
  "scenes": [
    { "id": string, "kind": "motion"|"footage", "template": string,
      "props": object, "caption": string|null, "query"?: string,
      "durationSec": number, "needsInput"?: boolean, "sourceBeat"?: string }
  ]
}
No markdown, no commentary.`;
}

export function plannerUserPrompt(
  script: string,
  analysis: PlannerAnalysis,
  options: PlannerOptions = {},
  repairHint?: string
): string {
  // Design pack: explicit user choice, or let the planner pick by content type.
  const theme =
    options.theme ||
    `CHOOSE the design pack that fits this content: "hype" (sports, challenges, predictions, energy), "tech" (AI, data, coding, product explainers), "editorial" (education, business, trust, essays), "warm" (lifestyle, fitness, food, personal stories). Set the plan's "theme" to exactly one of: hype, tech, editorial, warm`;
  const aspect = options.aspect || "9:16";
  const themes = analysis.themes?.length ? analysis.themes.join(", ") : "n/a";
  const points =
    analysis.structure?.body?.map((p, i) => `  ${i + 1}. ${p}`).join("\n") ||
    "  (parse points from the script markers)";

  return `SCRIPT (with section markers):
"""
${script}
"""

DETECTED POINTS:
${points}

THEMES: ${themes}
TONE: ${analysis.tone || "n/a"}

STYLE: theme: ${options.theme ? `"${theme}"` : theme}. aspect="${aspect}".
${repairHint ? `\nFIX THESE PROBLEMS FROM YOUR PREVIOUS ATTEMPT:\n${repairHint}\n` : ""}
Plan the scenes now. Return only the JSON ScenePlan.`;
}

// ── Validation ──

export interface ValidationResult {
  plan?: ScenePlan;
  errors: string[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate + normalize raw LLM output into a ScenePlan. Lenient where it can
 * safely repair (fills ids, clamps durations, defaults theme/aspect); hard-fails
 * on structural problems or unknown templates so the caller can retry.
 */
export function validateScenePlan(
  raw: unknown,
  options: PlannerOptions = {}
): ValidationResult {
  const errors: string[] = [];

  if (!isObject(raw)) {
    return { errors: ["Output is not a JSON object."] };
  }

  const rawScenes = raw.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    return { errors: ["`scenes` must be a non-empty array."] };
  }
  if (rawScenes.length > MAX_SCENES) {
    errors.push(`Too many scenes (${rawScenes.length} > ${MAX_SCENES}); extra will be dropped.`);
  }

  const aspect: Aspect = ASPECTS.includes(raw.aspect as Aspect)
    ? (raw.aspect as Aspect)
    : options.aspect || "9:16";
  const theme =
    typeof raw.theme === "string" && raw.theme ? raw.theme : options.theme || "tech";

  const scenes: Scene[] = [];
  rawScenes.slice(0, MAX_SCENES).forEach((s, i) => {
    const label = `scene[${i}]`;
    if (!isObject(s)) {
      errors.push(`${label}: not an object.`);
      return;
    }

    const template = s.template as Template;
    if (!ALL_TEMPLATES.includes(template)) {
      errors.push(`${label}: unknown template "${String(s.template)}".`);
      return;
    }

    const kind = s.kind === "footage" ? "footage" : "motion";
    const props = isObject(s.props) ? s.props : {};

    // Required props check
    const missing = REQUIRED_PROPS[template].filter(
      (k) => props[k] === undefined || props[k] === null
    );
    const needsInput = s.needsInput === true || missing.length > 0;
    if (missing.length > 0) {
      errors.push(
        `${label} (${template}): missing required prop(s) ${missing.join(", ")}.`
      );
    }

    // Footage needs a query (or a resolved assetRef)
    let query = typeof s.query === "string" ? s.query : undefined;
    if (template === "Footage" && !query && !s.assetRef) {
      errors.push(`${label} (Footage): missing "query".`);
      query = undefined;
    }

    // Clamp duration
    let durationSec = typeof s.durationSec === "number" ? s.durationSec : 3;
    durationSec = Math.min(DURATION_MAX, Math.max(DURATION_MIN, durationSec));

    scenes.push({
      id: typeof s.id === "string" && s.id ? s.id : `s${i + 1}`,
      kind,
      template,
      props,
      caption: typeof s.caption === "string" ? s.caption : null,
      query,
      assetRef: typeof s.assetRef === "string" ? s.assetRef : undefined,
      assetType: s.assetType === "image" || s.assetType === "video" ? s.assetType : undefined,
      assetCredit: typeof s.assetCredit === "string" ? s.assetCredit : undefined,
      durationSec,
      needsInput: needsInput || undefined,
      sourceBeat: typeof s.sourceBeat === "string" ? s.sourceBeat : undefined,
    });
  });

  if (scenes.length === 0) {
    return { errors: errors.length ? errors : ["No valid scenes produced."] };
  }

  const plan: ScenePlan = { version: 1, theme, aspect, scenes };
  return { plan, errors };
}
