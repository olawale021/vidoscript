# ScenePlan Contract & Template Catalog

The `ScenePlan` is the single interface between the **script side** (planner) and
the **render side** (Remotion). The planner emits it; the plan editor mutates it;
`renderFromPlan(scenePlan)` consumes it. Keep it stable and versioned.

- [1. Types](#1-types)
- [2. Template catalog](#2-template-catalog)
- [3. Planner: script → plan](#3-planner-script--plan)
- [4. LLM output schema](#4-llm-output-schema)
- [5. Worked example](#5-worked-example)
- [6. Validation rules](#6-validation-rules)

---

## 1. Types

```ts
// types/broll.ts
export type SceneKind = "motion" | "footage";

export type MotionTemplate =
  | "TitleCard"
  | "BigStat"
  | "Timeline"
  | "Comparison"
  | "Pipeline"
  | "BulletList"
  | "Quote"
  | "Reveal"
  | "Chart";

export type Template = MotionTemplate | "Footage";

export interface Scene {
  id: string;                       // stable id (for edit/reorder/regenerate)
  kind: SceneKind;                  // "motion" or "footage"
  template: Template;
  props: Record<string, unknown>;   // validated per-template (see catalog)
  caption?: string;                 // on-screen caption / lower-third
  query?: string;                   // footage only: stock search query
  assetRef?: string;                // footage only: resolved asset id/url + source
  durationSec: number;              // 1..15 typical
  needsInput?: boolean;             // planner couldn't fill required data
  sourceBeat?: string;              // which script marker this came from: "HOOK" | "POINT 2" | "CTA"
}

export interface ScenePlan {
  version: 1;
  theme: string;                    // brand/style token, e.g. "dark-emerald"
  aspect: "9:16" | "16:9" | "1:1";
  scenes: Scene[];
}
```

---

## 2. Template catalog

The **motion** templates are the ~70%; **Footage** is the ~30%. Each motion
template is a Remotion component with a **typed prop schema**. Start with ~8–10.

| Template | Kind | Purpose | Required props | Optional props |
|----------|------|---------|----------------|----------------|
| `TitleCard` | motion | Opening/section title | `title: string` | `subtitle`, `kicker` |
| `BigStat` | motion | One big animated number | `value: number`, `label: string` | `prefix`, `suffix`, `from` (count-up start) |
| `Timeline` | motion | Range/progression over time | `start: number`, `end: number`, `label: string` | `markers: {at:number,label:string}[]` |
| `Comparison` | motion | A vs B ("tale of the tape") | `left: {label,value}`, `right: {label,value}` | `metric` |
| `Pipeline` | motion | Sequential steps/flow | `steps: string[]` | `activeStep` |
| `BulletList` | motion | 2–5 key points | `items: string[]` | `title` |
| `Quote` | motion | Pull quote | `quote: string` | `attribution` |
| `Reveal` | motion | Word/phrase reveal for a punchy line | `lines: string[]` | — |
| `Chart` | motion | Bar/line of comparable values | `data: {label,value}[]`, `chartType: "bar"\|"line"` | `unit` |
| `Footage` | footage | Stock clip/image under caption | (uses `query`/`assetRef`) | `kenBurns: boolean` |

Design rules:
- Every template renders **on-brand from `theme`** (colors/fonts), never hardcoded
  brand marks.
- Every template accepts `durationSec` and animates within it (enter/hold/exit).
- Numeric props (`BigStat`, `Chart`, `Comparison`) are **never invented** by the
  planner — see validation rules.

---

## 3. Planner: script → plan

The planner reads the existing structured script (the `[HOOK] / [POINT n] /
[CTA]` markers and `analysis.structure.body[]`) and maps each **beat** to a
scene:

```
[HOOK]      → TitleCard or Reveal (grab attention)
[POINT 1]   → BigStat / Timeline / Comparison / BulletList (per content)
[POINT n]   → best-fit template for that point's content
atmospheric → Footage (breathe between data-heavy scenes) — ~30%
[CTA]       → TitleCard / Reveal (call to action)
```

Heuristics the planner is prompted with:
- A point with a **number** → `BigStat` or `Chart`.
- A point comparing **two things** → `Comparison`.
- A point describing a **process/steps** → `Pipeline`.
- A point that is a **list** → `BulletList`.
- A **year/time range** → `Timeline`.
- Narrative/atmospheric filler with no data → `Footage` (with a search `query`).
- Keep total scenes ≈ number of beats; durations sum to a sensible video length.

The existing `segments[]` timestamps (when a source video exists) can seed
`durationSec` per beat; without a source video, the planner assigns durations.

---

## 4. LLM output schema

The planner forces structured output (Gemini `responseMimeType: application/json`
/ OpenAI `response_format: json_object`), exactly like `analyzeTranscript`. The
model is given the template catalog and must return:

```jsonc
{
  "version": 1,
  "theme": "dark-emerald",
  "aspect": "9:16",
  "scenes": [
    {
      "id": "s1",
      "kind": "motion",
      "template": "TitleCard",
      "props": { "title": "The 3-2-1 Method", "kicker": "Content that ships" },
      "caption": null,
      "durationSec": 3,
      "sourceBeat": "HOOK"
    },
    {
      "id": "s2",
      "kind": "motion",
      "template": "BigStat",
      "props": { "value": 3, "label": "ideas a day", "from": 0 },
      "caption": "Start with three",
      "durationSec": 4,
      "sourceBeat": "POINT 1"
    },
    {
      "id": "s3",
      "kind": "footage",
      "template": "Footage",
      "props": { "kenBurns": true },
      "query": "person filming with phone, natural light",
      "caption": "Do it daily",
      "durationSec": 4,
      "sourceBeat": "POINT 2"
    }
  ]
}
```

Server-side, the JSON is validated against `types/broll.ts` (e.g. with a Zod
schema mirroring the validator) before it is stored. Invalid output → one retry
with the validation error appended, then surface to the user.

---

## 5. Worked example

Given today's sample generated script (the "3-2-1 / Content Flywheel" script in
the app), a plausible plan:

| # | Beat | Template | Key props | Dur |
|---|------|----------|-----------|-----|
| 1 | HOOK | `Reveal` | lines: ["Most ideas", "die in your head"] | 3s |
| 2 | POINT 1 | `BigStat` | value 1, label "topic" | 3s |
| 3 | POINT 2 | `Pipeline` | steps: ["Long-form","Short-form"] | 4s |
| 4 | POINT 3 | `BigStat` | value 3, label "platforms" | 3s |
| 5 | (breath) | `Footage` | query "creator editing video" | 3s |
| 6 | CTA | `TitleCard` | title "Try it for 14 days" | 3s |

Total ≈ 19s, 9:16 — a Reel. ~30% footage (1 of 6 scenes) matches the hybrid mix.

---

## 6. Validation rules

1. **Templates must be from the catalog.** Unknown `template` → reject.
2. **Required props present & typed.** Missing → reject or set `needsInput:true`
   for user-fillable data (never guess).
3. **No fabricated numbers.** `BigStat`/`Chart`/`Comparison` numeric props must be
   traceable to the script or user input; otherwise `needsInput:true` and the
   editor prompts the user.
4. **Duration bounds.** `1 ≤ durationSec ≤ 15`; total within the plan's max.
5. **Footage scenes** must have a non-empty `query` (or a user-supplied
   `assetRef`).
6. **Scene count** bounded in v1 (e.g. ≤ 12) to cap render cost.
7. **Version pinned** (`version: 1`) so future schema changes can migrate old
   plans.
