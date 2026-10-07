# B-Roll Generation — Documentation Index

**Feature:** turn a written script into a rendered b-roll video (hybrid motion
graphics + stock footage), saved to the user's history.

This folder is the spec for adding b-roll generation to **vidoscript** as it
exists *today*: **Next.js 16 + Convex + Clerk + Gemini/OpenAI**. It is written
against the real current codebase, not the older Postgres/Inngest/R2 plan.

## Documents

| Doc | What it covers |
|-----|----------------|
| [PRD.md](./PRD.md) | Problem, goals, scope, success metrics, non-goals, risks |
| [USER_STORIES.md](./USER_STORIES.md) | Epics + stories with acceptance criteria |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Pipeline, "can it run in Convex?", data model, render infra, sequence flows, file-by-file integration |
| [SCENE_PLAN.md](./SCENE_PLAN.md) | The `ScenePlan` contract, template catalog, planner schema |

## Decisions locked in (from product discovery)

| Decision | Choice |
|----------|--------|
| What "b-roll" means | **Hybrid**: ~70% generated motion graphics (Remotion), ~30% stock footage |
| MVP scope | **Full pipeline** — script → scene plan → rendered MP4 in history |
| Where rendering runs | **Not inside Convex.** Convex is the control plane; render runs on external compute (see below) |
| Audio & timing (v1) | **No audio.** Silent motion graphics + captions; per-scene durations from the planner |

## The short answer to "can rendering run in Convex?"

**No — and that's expected.** Remotion rendering needs a headless **Chromium**
browser + **ffmpeg**, several hundred MB of RAM, and often **minutes** of CPU
per video. Convex functions (queries/mutations/actions) run in a locked-down
serverless isolate with strict time/memory limits and **no ability to run
native binaries or a browser**. So the pixels cannot be produced in Convex.

**What Convex _is_ perfect for here** — and what we use it for:

- Storing the `ScenePlan` and the `renders` job records
- Reactive **live render status** in the UI (`useQuery` → progress with no polling)
- Holding the **input assets and the output MP4** (Convex File Storage, same as
  the source-video storage already built in `convex/projects.ts`)
- **Orchestrating**: a Convex `action` triggers the external renderer; a Convex
  mutation (called back by the renderer) marks the job done; `ctx.scheduler`
  handles timeouts/retries

So: **Convex = brain + memory. External worker = muscle.** See
[ARCHITECTURE.md](./ARCHITECTURE.md#rendering-why-not-in-convex) for the full
reasoning and the two render-infra options.

## Prerequisites (before building)

**Already in place (reused):**

- Convex deployment + File Storage (`optimistic-bison-873`)
- Clerk auth (per-user scoping)
- LLM provider abstraction — `lib/gemini.ts` / `lib/openai.ts` with `getProvider()`
- Existing script structure: `[HOOK] / [POINT N] / [CTA]` markers, `analysis.structure.body[]`, `segments[]` timestamps

**New, must acquire:**

- **Remotion license** — **free for you now.** Remotion is free for individuals
  and companies up to **3 people**, *including commercial use*. A paid Company
  License ($100/mo min) is required **only at 4+ people**. Solo/personal use =
  free, no signup. Revisit only if the team grows to 4+. (Verify current terms:
  https://www.remotion.pro/license)
- **Render compute** — either **Remotion Lambda** (AWS) or a **self-hosted
  container worker** (Railway/Render/Fly/Cloud Run). See architecture.
- **Stock asset API** — Pexels and/or Unsplash key for the ~30% footage scenes.
- **Fonts** — Google Fonts (license-safe). Avoid trademarked logos/emblems in
  templates; user-supplied or licensed assets only.

## Build roadmap (phased, even though MVP = full pipeline)

- **Phase 0 — Contract + Planner.** `types/broll.ts` (`ScenePlan`), `planScenes()`
  in both providers, `/api/broll/plan`, editable plan UI. Proves planning quality.
- **Phase 1 — Template library.** Bootstrap a Remotion project (the
  `product-video` skill can scaffold it), build ~10 templates + `renderFromPlan()`.
  Render locally from a plan JSON.
- **Phase 2 — Render pipeline.** `renders` table + Convex job orchestration +
  external worker + MP4 to Convex storage + reactive status on the project page.
- **Phase 3 — Hybrid assets.** Pexels/Unsplash resolver for footage scenes, brand
  kits, more templates.
- **Phase 4 — Scale & polish.** Remotion Lambda, TTS + timing, template variety,
  "regenerate this scene."

MVP (Phases 0–2) delivers the full script → rendered MP4 experience.
