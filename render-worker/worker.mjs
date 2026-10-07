// B-roll render worker. Polls Convex for queued renders, renders the ScenePlan
// to MP4 with Remotion, uploads the result to Convex File Storage, and marks the
// job done. Run locally (or deploy to a container) with:  npm run broll:worker
//
// Needs env: NEXT_PUBLIC_CONVEX_URL, BROLL_WORKER_SECRET (read from .env.local).

import { readFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { api } from "../convex/_generated/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load .env.local
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
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

async function renderOne(job) {
  console.log(`[worker] rendering ${job.id} (${job.scenePlan?.scenes?.length ?? 0} scenes)`);
  await convex.mutation(api.broll.markRendering, { secret: SECRET, renderId: job.id, progress: 1 });

  const composition = await selectComposition({
    serveUrl,
    id: "Broll",
    inputProps: { plan: job.scenePlan },
  });

  const outPath = join(tmpdir(), `broll-${job.id}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outPath,
    inputProps: { plan: job.scenePlan },
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
  const uploadUrl = await convex.mutation(api.broll.generateOutputUploadUrl, { secret: SECRET });
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: mp4,
  });
  const { storageId } = await res.json();
  await convex.mutation(api.broll.saveOutput, { secret: SECRET, renderId: job.id, storageId });
  await unlink(outPath).catch(() => {});
  console.log(`[worker] done ${job.id}`);
}

// Poll loop
while (true) {
  try {
    const queued = await convex.query(api.broll.listQueued, { secret: SECRET });
    for (const job of queued) {
      try {
        await renderOne(job);
      } catch (e) {
        console.error(`[worker] render failed for ${job.id}:`, e);
        await convex
          .mutation(api.broll.markFailed, {
            secret: SECRET,
            renderId: job.id,
            error: e instanceof Error ? e.message : String(e),
          })
          .catch(() => {});
      }
    }
  } catch (e) {
    console.error("[worker] poll error:", e);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
