// Face tracking for auto-reframe. Samples the clip at 4 fps with ffmpeg
// (seeking the R2 URL over HTTP), detects faces with UltraFace RFB-320
// (MIT, render-worker/models/) on onnxruntime-node, follows the largest face
// and smooths the path so the crop doesn't jitter.
//
// Returns { track: [{t, x}], srcAspect, faceFrames, frames } where t is source
// seconds and x is the face centre as a fraction of the source width.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";

// Prefer the system ffmpeg in Docker (FFMPEG_PATH); ffmpeg-static locally.
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
import * as ort from "onnxruntime-node";

const W = 320;
const H = 240;
const FPS = 4;
const SCORE_MIN = 0.7;
const MODEL = join(dirname(fileURLToPath(import.meta.url)), "models", "ultraface-rfb-320.onnx");

let session = null;
async function getSession() {
  session ??= await ort.InferenceSession.create(MODEL, { logSeverityLevel: 3 });
  return session;
}

// Stream raw RGB frames from ffmpeg; also capture the source dimensions.
function sampleFrames(url, start, duration, onFrame) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-hide_banner", "-nostdin",
      "-ss", String(start), "-t", String(duration), "-i", url,
      "-vf", `fps=${FPS},scale=${W}:${H}`,
      "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]);
    const frameBytes = W * H * 3;
    let buf = Buffer.alloc(0);
    let stderr = "";
    let index = 0;
    let chain = Promise.resolve();
    proc.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= frameBytes) {
        const frame = buf.subarray(0, frameBytes);
        buf = buf.subarray(frameBytes);
        const i = index++;
        const copy = Buffer.from(frame);
        chain = chain.then(() => onFrame(copy, i));
      }
    });
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      chain.then(() => {
        if (code !== 0) return reject(new Error(`ffmpeg (face track) exited ${code}`));
        const m = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
        resolve(m ? Number(m[1]) / Number(m[2]) : null);
      }, reject);
    });
  });
}

async function detect(frame) {
  const s = await getSession();
  const data = new Float32Array(3 * W * H);
  const plane = W * H;
  for (let i = 0; i < plane; i++) {
    data[i] = (frame[i * 3] - 127) / 128;
    data[plane + i] = (frame[i * 3 + 1] - 127) / 128;
    data[2 * plane + i] = (frame[i * 3 + 2] - 127) / 128;
  }
  const out = await s.run({ input: new ort.Tensor("float32", data, [1, 3, H, W]) });
  const scores = out.scores.data;
  const boxes = out.boxes.data;
  let best = null;
  for (let i = 0; i < scores.length / 2; i++) {
    const score = scores[i * 2 + 1];
    if (score < SCORE_MIN) continue;
    const x1 = boxes[i * 4], y1 = boxes[i * 4 + 1], x2 = boxes[i * 4 + 2], y2 = boxes[i * 4 + 3];
    const area = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (!best || area > best.area) best = { area, cx: (x1 + x2) / 2 };
  }
  return best ? Math.max(0, Math.min(1, best.cx)) : null;
}

export async function trackFaces(url, start, end) {
  const duration = Math.max(0.5, end - start);
  const raw = []; // { t, x|null }
  const srcAspect = await sampleFrames(url, start, duration, async (frame, i) => {
    raw.push({ t: start + i / FPS, x: await detect(frame) });
  });
  const faceFrames = raw.filter((r) => r.x !== null).length;
  if (faceFrames < Math.max(2, raw.length * 0.2)) {
    return { track: [], srcAspect, faceFrames, frames: raw.length };
  }

  // Fill gaps with the nearest detection.
  let last = raw.find((r) => r.x !== null).x;
  const filled = raw.map((r) => (r.x === null ? { t: r.t, x: last } : ((last = r.x), r)));

  // Dead zone (ignore small head movements) + exponential smoothing.
  const track = [];
  let target = filled[0].x;
  let cur = target;
  for (const r of filled) {
    if (Math.abs(r.x - target) > 0.06) target = r.x;
    cur += (target - cur) * 0.35;
    const x = Math.round(cur * 1000) / 1000;
    const prev = track[track.length - 1];
    if (!prev || Math.abs(prev.x - x) >= 0.004) track.push({ t: Math.round(r.t * 100) / 100, x });
  }
  const tail = filled[filled.length - 1];
  if (track[track.length - 1].t < tail.t) track.push({ t: Math.round(tail.t * 100) / 100, x: track[track.length - 1].x });
  return { track, srcAspect, faceFrames, frames: raw.length };
}
