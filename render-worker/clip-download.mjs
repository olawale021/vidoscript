// Pasted-link sources: download the YouTube video with Apify, copy it into R2,
// then hand back a signed URL so the normal ingest pipeline (clip-ingest.mjs)
// can run.
//   Primary:  marielise.dev/youtube-video-downloader — ≈ $0.02/min at 720p,
//             returns metadata, residential proxy only as a last resort.
//   Fallback: scraper_one/yt-downloader — ≈ $0.002/MB, returns only a link.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { api } from "../convex/_generated/api.js";

const ACTOR = "marielise.dev~youtube-video-downloader";
const FALLBACK_ACTOR = "scraper_one~yt-downloader";
const MAX_SECONDS = 60 * 60; // 1 hour — caps a download at ≈ $1.20
const MAX_BYTES = 4 * 1024 ** 3;
// USD (Apify FREE tier, Nov 2026)
const PER_MINUTE = { "360p": 0.01, "480p": 0.015, "720p": 0.02, "1080p": 0.03 }; // primary, per started minute
const RESIDENTIAL_PER_MB = 0.05; // primary, only if its proxy fallback was used
const FALLBACK_PER_MB = 0.002;
const LOOKUP_ACTOR = "streamers~youtube-scraper"; // metadata only, ≈ $0.004 per video
const LOOKUP_USD = 0.004;
const MB_PER_MIN_720P = 16; // measured: a 63-min video was 1,044 MB at 720p

async function apify(path, init = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set for the worker");
  const res = await fetch(`https://api.apify.com/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Apify ${path.split("?")[0]} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function runActor(actor, input, onWait) {
  let run = (await apify(`/acts/${actor}/runs?waitForFinish=60`, { method: "POST", body: JSON.stringify(input) })).data;
  for (let i = 0; run.status === "RUNNING" || run.status === "READY"; i++) {
    if (i > 60) throw new Error("Download timed out");
    await onWait(i);
    run = (await apify(`/actor-runs/${run.id}?waitForFinish=60`)).data;
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Download failed (${run.status})`);
  const [item] = await apify(`/datasets/${run.defaultDatasetId}/items?clean=true`);
  return item;
}

const tooLarge = (e) => /too large|lower quality/i.test(e instanceof Error ? e.message : String(e));

async function viaPrimary(job, onWait, quality = "720") {
  const item = await runActor(
    ACTOR,
    { urls: [{ url: job.sourceUrl }], quality, format: "default", residentialProxyMode: "fallback" },
    onWait
  );
  if (!item || item.status !== "success" || !item.downloadUrl) {
    throw new Error(item?.error || item?.errorMessage || "YouTube video could not be downloaded (private, age-restricted or removed?)");
  }
  const duration = Number(item.duration) || 0;
  const minutes = Math.max(1, Math.ceil(duration / 60));
  const residentialMb = item.residentialProxyUsed ? (Number(item.fileSizeBytes) || 0) / 1e6 : 0;
  return {
    actor: ACTOR,
    downloadUrl: item.downloadUrl,
    title: String(item.title ?? "YouTube video"),
    duration,
    cost: () => ({
      usd: minutes * (PER_MINUTE[item.deliveredQuality] ?? PER_MINUTE["720p"]) + residentialMb * RESIDENTIAL_PER_MB,
      units: minutes,
    }),
  };
}

async function viaFallback(job, onWait) {
  const item = await runActor(FALLBACK_ACTOR, { videoUrls: [job.sourceUrl], quality: "480p" }, onWait);
  if (!item?.downloadUrl) throw new Error("YouTube video could not be downloaded (private, age-restricted or removed?)");
  // This Actor returns only the link; take the title from YouTube's public oEmbed.
  let title = "YouTube video";
  try {
    const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(job.sourceUrl)}`);
    if (o.ok) title = (await o.json()).title ?? title;
  } catch {
    // keep default
  }
  return {
    actor: FALLBACK_ACTOR,
    downloadUrl: item.downloadUrl,
    title,
    duration: 0, // measured by the ingest step
    cost: (bytes) => ({ usd: (bytes / 1e6) * FALLBACK_PER_MB, units: Math.ceil(bytes / 1e6) }),
  };
}

function recordCost(convex, job, actor, usd, units) {
  if (!process.env.INTERNAL_API_SECRET) return;
  convex
    .mutation(api.usage.record, {
      secret: process.env.INTERNAL_API_SECRET,
      userId: job.userId,
      provider: "apify",
      model: actor.split("~")[1] ?? actor,
      feature: "clips.youtubeDownload",
      inputTokens: 0,
      outputTokens: units,
      costUsd: usd,
    })
    .catch(() => {});
}

// PUT a file to a presigned R2 URL with an explicit Content-Length (streamed).
function putFile(url, path, size) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": size } }, (res) => {
      res.resume();
      res.on("end", () =>
        res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error(`Upload to R2 failed (${res.statusCode})`))
      );
    });
    req.on("error", reject);
    createReadStream(path).pipe(req);
  });
}

const hms = (s) => String(s).split(":").reduce((acc, n) => acc * 60 + Number(n), 0);

// Pre-download lookup: title, length, thumbnail → estimated size and cost for
// the user to approve. Nothing is downloaded here.
export async function checkLinkSource({ convex, secret, job }) {
  const item = await runActor(
    LOOKUP_ACTOR,
    { startUrls: [{ url: job.sourceUrl }], maxResults: 1, maxResultsShorts: 0, maxResultStreams: 0, downloadSubtitles: false },
    async () => {}
  );
  recordCost(convex, job, LOOKUP_ACTOR, item ? LOOKUP_USD : 0, item ? 1 : 0);
  if (!item?.duration) throw new Error("Couldn't look this video up — it may be private, removed or a live stream");
  const seconds = hms(item.duration);
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (seconds > MAX_SECONDS) {
    throw new Error(
      `This video is ${Math.round(seconds / 60)} min long — the limit is ${MAX_SECONDS / 60} min. Only the $${LOOKUP_USD} lookup was charged.`
    );
  }
  await convex.mutation(api.clips.setChecked, {
    secret,
    sourceId: job.id,
    title: String(item.title ?? "YouTube video"),
    durationSec: seconds,
    ...(item.thumbnailUrl ? { thumbnailUrl: String(item.thumbnailUrl) } : {}),
    ...(item.channelName ? { channelName: String(item.channelName) } : {}),
    estimateMb: Math.round(minutes * MB_PER_MIN_720P),
    estimateUsd: Math.round(minutes * PER_MINUTE["720p"] * 100) / 100,
  });
  console.log(`[lookup] ${job.id}: ${item.title} — ${item.duration}`);
}

export async function downloadLinkSource({ convex, secret, job }) {
  const onWait = (i) =>
    convex
      .mutation(api.clips.setStep, { secret, sourceId: job.id, step: "downloading", progress: Math.min(4, 2 + i * 0.1) })
      .catch(() => {});
  const dir = await mkdtemp(join(tmpdir(), `dl-${job.id}-`));
  try {
    // Length comes from the pre-download lookup the user approved.
    console.log(`[download] ${job.id}: ${job.sourceUrl}`);
    const length = job.durationSec ?? null;
    if (length !== null && length > MAX_SECONDS) throw new Error(`Videos longer than ${MAX_SECONDS / 60} min aren't supported`);

    // 1. Get a download link. Primary Actor at 720p, then lower qualities if it
    //    says the file is too large. The fallback (billed per MB, no length
    //    info) only runs when the length is known to be within the limit.
    let found;
    let lastError;
    for (const quality of ["720", "480", "360"]) {
      try {
        found = await viaPrimary(job, onWait, quality);
        break;
      } catch (e) {
        lastError = e;
        if (!tooLarge(e)) break;
        console.warn(`[download] ${job.id}: too large at ${quality}p, trying lower`);
      }
    }
    if (!found) {
      if (length === null || tooLarge(lastError)) throw lastError;
      console.warn(`[download] ${job.id}: primary failed (${lastError instanceof Error ? lastError.message : lastError}); trying fallback`);
      try {
        found = await viaFallback(job, onWait);
      } catch {
        throw lastError; // the primary's error is usually the more specific one
      }
    }
    if (!found.duration && length) found.duration = length;

    // 2. Download the MP4 to disk.
    const path = join(dir, "source.mp4");
    const res = await fetch(found.downloadUrl);
    if (!res.ok || !res.body) throw new Error(`Could not fetch the downloaded video (${res.status})`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
    const { size } = await stat(path);
    const { usd, units } = found.cost(size);
    recordCost(convex, job, found.actor, usd, units);
    if (size < 1000) throw new Error("Downloaded file is empty");
    if (size > MAX_BYTES) throw new Error("Video is larger than 4 GB");
    if (found.duration > MAX_SECONDS) throw new Error(`Videos longer than ${MAX_SECONDS / 60} min aren't supported`);

    // 3. Copy into R2 at the source's key.
    const { putUrl } = await convex.mutation(api.clips.downloadTarget, { secret, sourceId: job.id });
    await putFile(putUrl, path, size);
    const { videoUrl } = await convex.mutation(api.clips.setDownloaded, {
      secret,
      sourceId: job.id,
      title: found.title,
      sizeBytes: size,
      ...(found.duration ? { durationSec: found.duration } : {}),
    });
    console.log(`[download] ${job.id}: via ${found.actor}, ${(size / 1e6).toFixed(1)} MB, $${usd.toFixed(3)}`);
    return { videoUrl, title: found.title };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
