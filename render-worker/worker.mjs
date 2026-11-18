// B-roll render worker. Polls Convex for queued renders, renders the ScenePlan
// to MP4 with Remotion, uploads the result to Cloudflare R2, and marks the
// job done. Run locally (or deploy to a container) with:  npm run broll:worker
//
// Needs env: NEXT_PUBLIC_CONVEX_URL, BROLL_WORKER_SECRET (from .env.local or the container).
// Also sends a host-health heartbeat every 30 s for the admin System page.

import { readFileSync } from "node:fs";
import { readFile, statfs, unlink } from "node:fs/promises";
import { cpus, freemem, loadavg, tmpdir, totalmem } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { getBrowser, resetBrowser } from "./browser.mjs";
import { api } from "../convex/_generated/api.js";
import { processClipSource } from "./clip-ingest.mjs";
import { renderClip } from "./clip-render.mjs";
import { runStoryJob } from "./story.mjs";
import { generateSmartEdit } from "./smart-edit.mjs";
import { checkLinkSource, downloadLinkSource } from "./clip-download.mjs";
import { reportError } from "./report.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load .env.local when present (local dev). In Docker, env comes from the container.
let envFile = "";
try {
  envFile = readFileSync(join(root, ".env.local"), "utf8");
} catch {
  // no .env.local — rely on process.env
}
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const SECRET = process.env.BROLL_WORKER_SECRET;
if (!CONVEX_URL || !SECRET) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL or BROLL_WORKER_SECRET");
  process.exit(1);
}

const convex = new ConvexHttpClient(CONVEX_URL);
const POLL_MS = 4000;

console.log("[worker] bundling Remotion project...");
const serveUrl = await bundle({ entryPoint: join(root, "remotion", "index.ts") });
console.log("[worker] ready. polling for queued renders...");

// ── Heartbeat: host health for the admin System page ──
// In the container, /proc reports the host's load and memory, and "/" is the host disk.
let currentRenderId = null;
let clipBusy = false;
// Jobs currently held, so a shutdown can hand them back to the queue.
const held = { source: null, smart: null, render: null };
const heldStory = new Set(); // story job ids
let stopping = false;
let clipRenderBusy = false;
let smartBusy = false;
const HEARTBEAT_MS = 30_000;

async function readMeminfo() {
  try {
    const text = await readFile("/proc/meminfo", "utf8");
    const kb = (key) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
    return {
      memTotal: kb("MemTotal"),
      memAvailable: kb("MemAvailable"),
      swapTotal: kb("SwapTotal"),
      swapFree: kb("SwapFree"),
    };
  } catch {
    return { memTotal: totalmem(), memAvailable: freemem(), swapTotal: 0, swapFree: 0 };
  }
}

async function heartbeat() {
  try {
    const [l1, l5, l15] = loadavg();
    const mem = await readMeminfo();
    const disk = await statfs("/");
    await convex.mutation(api.system.heartbeat, {
      secret: SECRET,
      loadAvg1: l1,
      loadAvg5: l5,
      loadAvg15: l15,
      cpuCount: cpus().length,
      ...mem,
      diskTotal: disk.blocks * disk.bsize,
      diskFree: disk.bavail * disk.bsize,
      workerBusy: currentRenderId !== null || clipBusy || clipRenderBusy || smartBusy,
      ...(currentRenderId ? { currentRenderId } : {}),
    });
  } catch (e) {
    console.error("[worker] heartbeat failed:", e instanceof Error ? e.message : e);
  }
}
heartbeat();
setInterval(heartbeat, HEARTBEAT_MS);

async function renderOne(job) {
  console.log(`[worker] rendering ${job.id} (${job.scenePlan?.scenes?.length ?? 0} scenes)`);
  await convex.mutation(api.broll.markRendering, { secret: SECRET, renderId: job.id, progress: 1 });

  const puppeteerInstance = await getBrowser();
  const composition = await selectComposition({
    serveUrl,
    id: "Broll",
    inputProps: { plan: job.scenePlan },
    puppeteerInstance,
  });

  const outPath = join(tmpdir(), `broll-${job.id}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    x264Preset: "veryfast",
    outputLocation: outPath,
    inputProps: { plan: job.scenePlan },
    puppeteerInstance,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 10 === 0) {
        convex
          .mutation(api.broll.markRendering, { secret: SECRET, renderId: job.id, progress: pct })
          .catch(() => {});
      }
    },
  });

  const mp4 = await readFile(outPath);
  const { url, key } = await convex.mutation(api.broll.generateOutputUpload, { secret: SECRET, renderId: job.id });
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: mp4,
  });
  if (!res.ok) throw new Error(`Upload to R2 failed (${res.status})`);
  await convex.mutation(api.broll.saveOutput, { secret: SECRET, renderId: job.id, key });
  await unlink(outPath).catch(() => {});
  console.log(`[worker] done ${job.id}`);
}

// Link lookups are quick (~10 s): look up length/size so the user can approve.
async function processLinkChecks() {
  const job = await convex.mutation(api.clips.claimNextCheck, { secret: SECRET });
  if (!job) return false;
  try {
    await checkLinkSource({ convex, secret: SECRET, job });
  } catch (e) {
    console.error(`[worker] link lookup failed for ${job.id}:`, e instanceof Error ? e.message : e);
    reportError(convex, { feature: "clips.youtubeLookup", error: e, userId: job.userId, sourceId: job.id });
    await convex
      .mutation(api.clips.fail, { secret: SECRET, sourceId: job.id, error: e instanceof Error ? e.message : String(e) })
      .catch(() => {});
  }
  return true;
}

async function processClips() {
  // One clip source at a time; claimNext marks it "processing" atomically.
  if (stopping) return false;
  const job = await convex.mutation(api.clips.claimNext, { secret: SECRET });
  if (!job) return false;
  clipBusy = true;
  held.source = job.id;
  try {
    if (job.sourceType === "url") {
      const { videoUrl, title } = await downloadLinkSource({ convex, secret: SECRET, job });
      job.videoUrl = videoUrl;
      job.title = title;
    }
    await processClipSource({ convex, secret: SECRET, job });
  } catch (e) {
    if (e?.code === "QUALITY_BLOCKED") {
      console.warn(`[worker] ${job.id}: ${e.message}`);
      await convex.mutation(api.clips.backToConfirm, { secret: SECRET, sourceId: job.id, error: e.message }).catch(() => {});
      return true;
    }
    console.error(`[worker] clip source failed for ${job.id}:`, e);
    reportError(convex, {
      feature: job.findMore ? "clips.findMore" : job.sourceType === "url" ? "clips.youtube" : "clips.ingest",
      error: e,
      userId: job.userId,
      sourceId: job.id,
    });
    await convex
      .mutation(api.clips.fail, {
        secret: SECRET,
        sourceId: job.id,
        error: e instanceof Error ? e.message : String(e),
      })
      .catch(() => {});
  } finally {
    clipBusy = false;
    held.source = null;
  }
  return true;
}

async function processClipRenders() {
  if (stopping) return false;
  const job = await convex.mutation(api.clipEditor.claimNextRender, { secret: SECRET });
  if (!job) return false;
  clipRenderBusy = true;
  held.render = job.id;
  try {
    await renderClip({ convex, secret: SECRET, serveUrl, job });
  } catch (e) {
    console.error(`[worker] clip render failed for ${job.id}:`, e);
    reportError(convex, { feature: "clips.export", error: e, userId: job.userId, clipId: job.id });
    await convex
      .mutation(api.clipEditor.failRender, {
        secret: SECRET,
        clipId: job.id,
        error: e instanceof Error ? e.message : String(e),
      })
      .catch(() => {});
  } finally {
    clipRenderBusy = false;
    held.render = null;
  }
  return true;
}

async function processSmartEdits() {
  if (stopping) return false;
  const job = await convex.mutation(api.smartEdit.claimNext, { secret: SECRET });
  if (!job) return false;
  smartBusy = true;
  held.smart = job.id;
  try {
    console.log(`[smart] ${job.id}: generating smart edits`);
    const smart = await generateSmartEdit({ convex, job });
    await convex.mutation(api.smartEdit.saveGenerated, { secret: SECRET, clipId: job.id, smart });
    console.log(`[smart] ${job.id}: done (${smart.removals.length} cuts, ${smart.zooms.length} zooms, ${smart.broll.length} b-roll)`);
  } catch (e) {
    console.error(`[worker] smart edit failed for ${job.id}:`, e);
    reportError(convex, { feature: "clips.smartEdit", error: e, userId: job.userId, clipId: job.id });
    await convex
      .mutation(api.smartEdit.fail, { secret: SECRET, clipId: job.id, error: e instanceof Error ? e.message : String(e) })
      .catch(() => {});
  } finally {
    smartBusy = false;
    held.smart = null;
  }
  return true;
}

// Graceful shutdown (docker stop / redeploy): hand held jobs back to the
// queue so the next worker picks them up immediately, then exit.
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal}: releasing held jobs`);
  const tasks = [];
  if (held.source) tasks.push(convex.mutation(api.clips.releaseSource, { secret: SECRET, sourceId: held.source }));
  if (held.smart) tasks.push(convex.mutation(api.smartEdit.release, { secret: SECRET, clipId: held.smart }));
  if (held.render) tasks.push(convex.mutation(api.clipEditor.releaseRender, { secret: SECRET, clipId: held.render }));
  for (const jobId of heldStory) tasks.push(convex.mutation(api.storyWorker.releaseJob, { secret: SECRET, jobId }));
  await Promise.allSettled(tasks);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Story Studio jobs (render-worker/story.mjs) ──
// AI steps (script, plan, images, voice) run in two background lanes so a long
// export never blocks them; story exports run in the main loop like clip exports.
const STORY_AI_KINDS = ["script", "plan", "ref", "still", "voice"];

async function processStoryJob(kinds) {
  const job = await convex.mutation(api.storyWorker.claimJob, { secret: SECRET, kinds });
  if (!job) return false;
  if (job.skip) return true;
  heldStory.add(job.jobId);
  const label = `${job.kind} ${job.shotId ?? job.item?.id ?? job.storyId}`;
  const t0 = Date.now();
  try {
    console.log(`[story] ${label}: start`);
    await runStoryJob({ convex, secret: SECRET, serveUrl, job });
    console.log(`[story] ${label}: done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`[story] ${label} failed:`, e);
    reportError(convex, { feature: `story.${job.kind}`, error: e, userId: job.userId });
    await convex
      .mutation(api.storyWorker.failJob, { secret: SECRET, jobId: job.jobId, error: e instanceof Error ? e.message : String(e) })
      .catch(() => {});
  } finally {
    heldStory.delete(job.jobId);
  }
  return true;
}

async function storyLane(kinds = STORY_AI_KINDS) {
  while (!stopping) {
    let worked = false;
    try {
      worked = await processStoryJob(kinds);
    } catch (e) {
      console.error("[worker] story poll error:", e);
    }
    if (!worked) await new Promise((r) => setTimeout(r, 3000));
  }
}
storyLane();
storyLane();
// AI video clips (Phase 2) mostly wait on Higgsfield, so they get their own
// lanes and never hold up scripts, pictures or voices.
storyLane(["video"]);
storyLane(["video"]);
storyLane(["video"]);

// Poll loop: clip sources first (users wait on them), then smart edits,
// clip exports, then B-roll renders.
while (true) {
  try {
    for (let i = 0; i < 5 && (await processLinkChecks()); i++);
  } catch (e) {
    console.error("[worker] link check poll error:", e);
  }
  try {
    await processClips();
  } catch (e) {
    console.error("[worker] clip poll error:", e);
  }
  try {
    // Drain smart-edit jobs (fast) before the next render.
    for (let i = 0; i < 5 && (await processSmartEdits()); i++);
  } catch (e) {
    console.error("[worker] smart edit poll error:", e);
  }
  try {
    await processClipRenders();
  } catch (e) {
    console.error("[worker] clip render poll error:", e);
  }
  try {
    await processStoryJob(["render"]);
  } catch (e) {
    console.error("[worker] story render poll error:", e);
  }
  try {
    const queued = await convex.query(api.broll.listQueued, { secret: SECRET });
    for (const job of queued) {
      currentRenderId = job.id;
      try {
        await renderOne(job);
      } catch (e) {
        console.error(`[worker] render failed for ${job.id}:`, e);
        await resetBrowser();
        reportError(convex, { feature: "broll.render", error: e });
        await convex
          .mutation(api.broll.markFailed, {
            secret: SECRET,
            renderId: job.id,
            error: e instanceof Error ? e.message : String(e),
          })
          .catch(() => {});
      } finally {
        currentRenderId = null;
      }
    }
  } catch (e) {
    console.error("[worker] poll error:", e);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
