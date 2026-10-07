# B-roll render worker

Renders queued b-roll `ScenePlan`s into MP4s with Remotion and uploads them to
Convex File Storage. It's decoupled from the web app — Convex is the control
plane (job queue + storage + reactive status), this worker is the "muscle"
(Chromium + ffmpeg) that can't run inside Convex.

## Run it (locally)

```bash
npm run broll:worker
```

On first run it downloads a headless Chromium (~93 MB), bundles the Remotion
project (`remotion/index.ts`), then polls Convex every few seconds for renders in
`queued` status. For each it: marks `rendering` (with progress), renders the
plan, uploads the MP4, and marks `done`.

Leave it running in its own terminal while you use the app. Click **Export MP4**
in the B-roll tab → the job is queued → this worker renders it → the **Download
MP4** button appears in the app (reactive, no refresh).

## Env

Read from `.env.local` automatically:

- `NEXT_PUBLIC_CONVEX_URL` — the Convex deployment (set by `npx convex dev`)
- `BROLL_WORKER_SECRET` — shared secret the worker uses on Convex callbacks.
  Must match the value set on the deployment:
  `npx convex env set BROLL_WORKER_SECRET <secret>` (already done in setup).

## Deploying (later)

The worker is host-agnostic. To scale beyond your machine, containerize it
(Node + this repo) and run it on Railway / Render / Fly / Cloud Run, or swap the
render call for **Remotion Lambda**. The Convex contract (`listQueued`,
`markRendering`, `generateOutputUploadUrl`, `saveOutput`, `markFailed`) stays the
same. See `docs/broll/ARCHITECTURE.md`.
```
