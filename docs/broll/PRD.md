# PRD — B-Roll Generation

**Status:** Draft · **Owner:** Joel · **Stack:** Next.js 16, Convex, Clerk,
Gemini/OpenAI · **Related:** [ARCHITECTURE.md](./ARCHITECTURE.md),
[USER_STORIES.md](./USER_STORIES.md), [SCENE_PLAN.md](./SCENE_PLAN.md)

## 1. Problem

vidoscript already turns a source video/idea into a polished **script**
(`[HOOK] / [POINT N] / [CTA]`, with tone, themes, and timing). But a script is
the *start* of a video, not the end. To actually publish, a creator still has to
find footage, build motion graphics, and edit — the slowest, most skill-gated
part of the workflow.

**We want to close the loop:** from a finished script, generate the **b-roll
video** automatically — a hybrid of code-driven motion graphics (stats,
timelines, comparisons, title cards) and stock footage — rendered to an MP4 the
user can download, all inside the existing project.

## 2. Goals & non-goals

### Goals (v1)

- G1. From a saved script, produce an **editable scene plan** (which visual each
  beat becomes) using the AI planner.
- G2. Render that plan to a **downloadable MP4** (silent, captioned) — hybrid
  motion graphics (~70%) + stock footage (~30%).
- G3. Save renders to the user's **history**, owner-scoped (Clerk), with **live
  status** while rendering.
- G4. Let the user **edit the plan** (swap template, edit caption/data, reorder,
  change duration) and re-render.
- G5. Reuse existing infrastructure — LLM abstraction, Convex storage, Clerk auth
  — with no new database system.

### Non-goals (v1)

- N1. **Voiceover / TTS / audio.** v1 is silent motion graphics + captions.
- N2. **Frame-perfect VO sync.** Durations come from the planner, not speech.
- N3. **Full timeline video editor.** Editing is at the *scene-plan* level (a
  list of scenes), not a keyframe timeline.
- N4. **AI-generated video clips.** v1 footage = stock (Pexels/Unsplash). AI clip
  generation is a later exploration.
- N5. **Collaboration / multi-user editing** on a render.

## 3. Scope — MVP = full pipeline

The MVP is the complete path, not a mockup:

```
saved script  →  AI planner  →  ScenePlan (editable)  →  render job  →  MP4 in history
```

Delivered surfaces:

- A **"Generate B-roll"** action on the project view.
- A **Scene Plan editor** (list of scenes: template, caption, data, duration;
  reorder, add, delete, regenerate one).
- A **render trigger** + **live progress** (queued → planning → rendering → done).
- A **preview + download** of the finished MP4, saved to the project.

## 4. Users & primary flow

**Primary user:** a solo creator / marketer who has written (or generated) a
script in vidoscript and wants a video without editing skills.

**Happy path:**

1. User opens a project that has a generated script.
2. Clicks **Generate B-roll**.
3. App plans scenes; user reviews/edits the scene plan.
4. User clicks **Render**; watches live progress.
5. MP4 appears in the project; user previews and downloads.

## 5. Functional requirements

| # | Requirement |
|---|-------------|
| FR1 | Generate a `ScenePlan` from a script via the LLM planner, constrained to a strict JSON schema (only real templates + valid props). |
| FR2 | Each scene declares a `kind` (`motion` or `footage`), a `template`/`query`, `props`, `caption`, and `durationSec`. |
| FR3 | The scene-plan editor supports: edit caption/props, change template, reorder, add/delete scene, regenerate a single scene, edit duration. |
| FR4 | For `footage` scenes, resolve a stock clip/image from a provider (Pexels/Unsplash) by keyword; allow user override/replace. |
| FR5 | A render job renders the plan to MP4 on external compute; the output is stored in Convex File Storage and linked to the project. |
| FR6 | Render status is **reactive** (queued/planning/rendering/done/failed + %); no manual refresh. |
| FR7 | Renders are **owner-scoped** by Clerk identity; a user only sees/edits their own. |
| FR8 | User can download the MP4 and re-render after edits (new render record, history preserved). |
| FR9 | The planner must **not invent statistics**; numeric props come from the script/user, or the scene is flagged for user input. |
| FR10 | Failures are surfaced with a reason and a retry; partial work (the plan) is never lost. |

## 6. Success metrics

- **Plan acceptance rate:** % of generated scene plans a user renders without
  heavy editing (target: >50% render with ≤3 edits).
- **Time to first MP4:** median script → downloaded video (target: < 5 min incl.
  render).
- **Render success rate:** completed / attempted (target: > 95%).
- **Re-render rate:** healthy iteration, not frustration — track edits per render.
- **Cost per render:** LLM tokens + compute + asset calls (must stay predictable;
  see architecture cost drivers).

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Planner picks poor/irrelevant visuals** (the hard 20%) | Strict JSON schema, few-shot examples, per-scene "regenerate", evals on a sample script set |
| **Render infra cost/latency** | Start with one container worker; cap concurrent renders; move to Lambda for scale; async + notify |
| **Asset licensing** (trademarks, stock terms) | Only Pexels/Unsplash (clear license) or user uploads; never scrape logos/emblems; store attribution |
| **Remotion license** | **Not a blocker at current size.** Free for individuals/companies ≤3 people (incl. commercial). Company License ($100/mo min) only at 4+ people — revisit if the team grows |
| **AI-invented data** | Never let the planner fabricate numbers; require source/user input for `BigStat`/`Chart` props |
| **Convex can't render** | Designed for it — Convex orchestrates, external worker renders (see architecture) |
| **Long videos exceed limits** | Cap v1 script length / scene count; chunk later |

## 8. Open questions (track, don't block)

- Which stock provider first — Pexels (video) vs Unsplash (images)? (Lean Pexels
  for motion.)
- Render worker host — Railway container vs Remotion Lambda for MVP? (Lean single
  container worker for MVP simplicity, Lambda for scale.)
- Do we template a **brand kit** (colors/fonts/logo) in v1 or v2? (Lean v2, but
  design the plan to carry a `theme`.)
- Aspect ratios in v1 — 9:16 only, or 16:9 + 1:1 too? (Lean 9:16 first for
  Reels/Shorts.)
