// Clip export, run by the render worker for each queued clip render:
//   1. cut just the clip's segment out of the source in R2 with ffmpeg
//      (seeking over HTTP, so a long source is never fully downloaded)
//   2. render the Remotion "Clip" composition (reframe + animated captions)
//      against that local segment
//   3. upload the MP4 to R2 and report back to Convex (convex/clipEditor.ts)

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Prefer the system ffmpeg in Docker (FFMPEG_PATH); ffmpeg-static locally.
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
import { selectComposition, renderMedia } from "@remotion/renderer";
import { api } from "../convex/_generated/api.js";

// ── Tiny local file server (Range-capable) so Remotion can read segments ──

const served = new Map(); // name -> absolute path
let baseUrl = null;

async function ensureServer() {
  if (baseUrl) return baseUrl;
  const server = createServer(async (req, res) => {
    const name = decodeURIComponent((req.url ?? "/").slice(1).split("?")[0]);
    const path = served.get(name);
    if (!path) {
      res.writeHead(404).end();
      return;
    }
    try {
      const { size } = await stat(path);
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      const headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        createReadStream(path, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, "Content-Length": size });
        createReadStream(path).pipe(res);
      }
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-y", ...args]);
    let err = "";
    proc.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.split("\n").slice(-3).join(" ").trim()}`))
    );
  });
}

export async function renderClip({ convex, secret, serveUrl, job }) {
  const dir = await mkdtemp(join(tmpdir(), `cliprender-${job.id}-`));
  const progress = (p) => convex.mutation(api.clipEditor.renderProgress, { secret, clipId: job.id, progress: p }).catch(() => {});
  try {
    const duration = Math.max(0.5, job.end - job.start);

    // 1. Cut the segment (frame-accurate re-encode; input seek keeps it fast).
    console.log(`[clip-render] ${job.id}: cutting ${job.start}s–${job.end}s`);
    const segPath = join(dir, `seg-${job.id}.mp4`);
    await ffmpeg([
      "-ss", String(job.start),
      "-i", job.sourceUrl,
      "-t", String(duration),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      segPath,
    ]);
    await progress(10);

    // 2. Render the composition against the local segment.
    const base = await ensureServer();
    const name = basename(segPath);
    served.set(name, segPath);
    const inputProps = {
      videoUrl: `${base}/${encodeURIComponent(name)}`,
      videoOffsetSec: job.start, // the local segment starts at the clip start
      start: job.start,
      end: job.end,
      smart: job.smart ?? null,
      aspect: job.aspect,
      captionStyle: job.captionStyle,
      captionPosition: job.captionPosition,
      cropX: job.cropX,
      words: job.words,
    };
    const composition = await selectComposition({ serveUrl, id: "Clip", inputProps });
    const outPath = join(dir, `clip-${job.id}.mp4`);
    let last = -1;
    console.log(`[clip-render] ${job.id}: rendering ${composition.width}x${composition.height}, ${composition.durationInFrames} frames`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outPath,
      inputProps,
      onProgress: ({ progress: p }) => {
        const pct = 10 + Math.round(p * 85);
        if (pct - last >= 5) {
          last = pct;
          progress(pct);
        }
      },
    });
    served.delete(name);

    // 3. Upload to R2.
    const { url, key } = await convex.mutation(api.clipEditor.generateRenderUpload, { secret, clipId: job.id });
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: await readFile(outPath) });
    if (!res.ok) throw new Error(`Upload to R2 failed (${res.status})`);
    await convex.mutation(api.clipEditor.saveRender, { secret, clipId: job.id, key });
    console.log(`[clip-render] ${job.id}: done`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
