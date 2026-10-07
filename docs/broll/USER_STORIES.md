# User Stories — B-Roll Generation

Format: **As a** \<role\>, **I want** \<capability\>, **so that** \<value\>.
Each story lists acceptance criteria (AC). Roles: **Creator** (end user),
**System** (automated behavior).

Legend: 🟢 MVP (Phases 0–2) · 🔵 Later (Phases 3–4)

---

## Epic A — Generate a scene plan from a script

### A1 🟢 Kick off b-roll from a script
**As a** Creator, **I want** a "Generate B-roll" action on a project that has a
script, **so that** I can start making a video without leaving the app.

- AC1: The action is visible only when the project has a non-empty generated script.
- AC2: Clicking it creates a render record in state `planning` and shows progress.
- AC3: If the user is signed out, the action is unavailable (Clerk-gated).

### A2 🟢 Auto-plan scenes from the script
**As a** Creator, **I want** the AI to segment my script into scenes and pick a
visual for each, **so that** I get a starting storyboard automatically.

- AC1: The planner returns a `ScenePlan` validated against the schema
  (see [SCENE_PLAN.md](./SCENE_PLAN.md)); invalid output is rejected/retried.
- AC2: Each scene has `kind` (`motion`|`footage`), template/query, `props`,
  `caption`, `durationSec`.
- AC3: Scene order follows the script order (`[HOOK] → [POINT n] → [CTA]`).
- AC4: The planner never fabricates statistics (numeric props require source/user
  input or the scene is flagged `needsInput`).

### A3 🟢 Review the plan before rendering
**As a** Creator, **I want** to see the full scene plan as an editable list,
**so that** I can fix anything before spending a render.

- AC1: Each scene shows template name, caption, key props, and duration.
- AC2: A lightweight in-browser preview (Remotion Player) plays the plan without a
  server render.
- AC3: Total estimated duration is shown.

---

## Epic B — Edit the scene plan

### B1 🟢 Edit a scene's content
**As a** Creator, **I want** to edit a scene's caption and data props, **so that**
I can correct wording and numbers.

- AC1: Editing a caption/prop updates the preview live.
- AC2: Prop editors are typed per template (number field for a stat, date for a
  timeline, etc.).
- AC3: Edits autosave to the render's `scenePlan` (Convex), owner-scoped.

### B2 🟢 Change a scene's template
**As a** Creator, **I want** to swap a scene to a different template, **so that**
I can pick a better visual.

- AC1: A template picker lists compatible templates.
- AC2: Switching maps/asks for the new template's required props.

### B3 🟢 Reorder / add / delete scenes
**As a** Creator, **I want** to reorder, add, and remove scenes, **so that** I
control the storyboard.

- AC1: Drag-to-reorder (or up/down) updates the plan and preview.
- AC2: Add inserts a blank scene of a chosen template; delete removes it.

### B4 🟢 Regenerate a single scene
**As a** Creator, **I want** to regenerate just one scene with the AI, **so that**
I can get a better option without redoing the whole plan.

- AC1: "Regenerate scene" returns 1–N alternatives for that beat only.
- AC2: The rest of the plan is untouched (mirrors the existing per-section script
  regeneration UX).

### B5 🔵 Pick/replace stock footage
**As a** Creator, **I want** to choose the stock clip for a footage scene, **so
that** the visual is relevant.

- AC1: Footage scenes show the resolved clip + a "replace" search.
- AC2: Search hits Pexels/Unsplash; selection stores the asset ref + attribution.

---

## Epic C — Render to video

### C1 🟢 Render the plan to MP4
**As a** Creator, **I want** to render my scene plan into a downloadable MP4,
**so that** I can publish it.

- AC1: "Render" enqueues a job; the render runs on external compute (not Convex).
- AC2: On success, the MP4 is stored in Convex File Storage and linked to the
  render record.
- AC3: Output defaults to 9:16 (configurable later), silent, with captions.

### C2 🟢 See live render progress
**As a** Creator, **I want** live status while rendering, **so that** I know it's
working and when it's done.

- AC1: Status transitions `queued → rendering → done|failed` are reactive
  (`useQuery`), no refresh.
- AC2: A progress % / current-frame indicator updates during render.
- AC3: On completion the preview/download appears automatically.

### C3 🟢 Handle render failure gracefully
**As a** Creator, **I want** clear errors and a retry, **so that** a failure
doesn't lose my work.

- AC1: Failure shows a human-readable reason.
- AC2: A "Retry" re-runs the render from the saved plan.
- AC3: The `scenePlan` is never lost on failure.

### C4 🟢 Download & keep in history
**As a** Creator, **I want** finished renders saved in my history, **so that** I
can re-download or re-render later.

- AC1: Each project lists its renders (newest first) with status + thumbnail.
- AC2: Download fetches the MP4 from storage.
- AC3: Re-rendering after edits creates a new render record (history preserved).

---

## Epic D — Platform & trust

### D1 🟢 Owner-scoped renders
**As a** Creator, **I want** my renders private to me, **so that** others can't
see or edit them.

- AC1: All render queries/mutations check Clerk identity server-side.
- AC2: A user can only read/modify their own renders (mirrors `projects`).

### D2 🔵 Brand kit
**As a** Creator, **I want** to apply my colors/fonts/logo, **so that** videos
look on-brand.

- AC1: A `theme`/brand kit is carried in the `ScenePlan` and honored by templates.

### D3 🔵 Aspect ratio & length options
**As a** Creator, **I want** to choose aspect ratio (9:16 / 16:9 / 1:1), **so
that** I can target different platforms.

---

## Story map → phases

| Phase | Stories |
|-------|---------|
| **0 — Contract + Planner** | A1, A2, A3 (plan-only), B1, B4 |
| **1 — Template library** | A3 preview, render `renderFromPlan` locally |
| **2 — Render pipeline** | C1, C2, C3, C4, D1, B2, B3 |
| **3 — Hybrid assets** | B5, D2 |
| **4 — Scale & polish** | D3, TTS/timing, template variety |
