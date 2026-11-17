// Pasted-link sources: look up, then download the YouTube video with Apify,
// copy it into R2, and hand back a signed URL so the normal ingest pipeline
// (clip-ingest.mjs) can run.
//
//   Lookup:   johnvc/youtube-download-api (metadataOnly, ≈ $0.00002)
//             → streamers/youtube-scraper as a fallback (≈ $0.004)
//   Download: johnvc/youtube-download-api (≈ $0.000011 per minute, H.264 MP4,
//             any quality; failed or skipped videos are free)
//             → marielise.dev/youtube-video-downloader (≈ $0.02/min at 720p,
//               proven, residential-proxy fallback) from the picked quality down.

import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { api } from "../convex/_generated/api.js";

const JOHNVC = "johnvc~youtube-download-api";
const MARIELISE = "marielise.dev~youtube-video-downloader";
const LOOKUP_FALLBACK = "streamers~youtube-scraper";

const MAX_SECONDS = 60 * 60; // 1 hour
const MAX_BYTES = 4 * 1024 ** 3;
const RUN_CAP_USD = 2; // hard cap per Apify run (maxTotalChargeUsd)

// USD (Apify FREE tier, Nov 2026)
const JOHNVC_PER_MIN = 0.000011;
const JOHNVC_OVERHEAD = 0.00002; // actor start + dataset row
const MARIELISE_PER_MIN = { "360": 0.01, "480": 0.015, "720": 0.02, "1080": 0.03 };
const RESIDENTIAL_PER_MB = 0.05;
const LOOKUP_FALLBACK_USD = 0.004;
const MB_PER_MIN_720 = 16; // measured: a 63-min video was 1,044 MB at 720p

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

async function runActor(actor, input, onWait = async () => {}) {
  let run = (
    await apify(`/acts/${actor}/runs?waitForFinish=60&maxTotalChargeUsd=${RUN_CAP_USD}`, {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).data;
  for (let i = 0; run.status === "RUNNING" || run.status === "READY"; i++) {
    if (i > 60) throw new Error("Download timed out");
    await onWait(i);
    run = (await apify(`/actor-runs/${run.id}?waitForFinish=60`)).data;
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Download failed (${run.status})`);
  const [item] = await apify(`/datasets/${run.defaultDatasetId}/items?clean=true`);
  return item;
}

function recordCost(convex, job, actor, usd, units, feature) {
  if (!process.env.INTERNAL_API_SECRET) return;
  convex
    .mutation(api.usage.record, {
      secret: process.env.INTERNAL_API_SECRET,
      userId: job.userId,
      provider: "apify",
      model: actor.split("~")[1] ?? actor,
      feature,
      inputTokens: 0,
      outputTokens: units,
      costUsd: usd,
    })
    .catch(() => {});
}

const hms = (s) => String(s).split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
const qNum = (q) => String(q).replace(/p$/i, "");

// ── Lookup (before the user approves) ──

async function lookupJohnvc(job, convex) {
  const item = await runActor(JOHNVC, {
    videoUrls: [job.sourceUrl],
    metadataOnly: true,
    format: "video",
    quality: "720p",
    videoCodec: "h264",
  });
  recordCost(convex, job, JOHNVC, JOHNVC_OVERHEAD, 0, "clips.youtubeLookup");
  const seconds = Number(item?.durationSeconds) || 0;
  if (!item || !seconds) throw new Error(item?.error || "no metadata");
  const available = Array.isArray(item.availableQualities)
    ? item.availableQualities.map(qNum)
    : String(item.availableQualities ?? "").match(/\d{3,4}/g) ?? [];
  return {
    title: String(item.title ?? "YouTube video"),
    seconds,
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl) : undefined,
    channelName: item.channelName ? String(item.channelName) : undefined,
    available,
    estimateBytes720: Number(item.estimatedSizeBytes) || 0,
  };
}

async function lookupFallback(job, convex) {
  const item = await runActor(LOOKUP_FALLBACK, {
    startUrls: [{ url: job.sourceUrl }],
    maxResults: 1,
    maxResultsShorts: 0,
    maxResultStreams: 0,
    downloadSubtitles: false,
  });
  recordCost(convex, job, LOOKUP_FALLBACK, item ? LOOKUP_FALLBACK_USD : 0, item ? 1 : 0, "clips.youtubeLookup");
  if (!item?.duration) throw new Error("Couldn't look this video up — it may be private, removed or a live stream");
  return {
    title: String(item.title ?? "YouTube video"),
    seconds: hms(item.duration),
    thumbnailUrl: item.thumbnailUrl ? String(item.thumbnailUrl) : undefined,
    channelName: item.channelName ? String(item.channelName) : undefined,
    available: [],
    estimateBytes720: 0,
  };
}

export async function checkLinkSource({ convex, secret, job }) {
  let meta;
  try {
    meta = await lookupJohnvc(job, convex);
  } catch (e) {
    console.warn(`[lookup] ${job.id}: johnvc lookup failed (${e instanceof Error ? e.message : e}); using fallback`);
    meta = await lookupFallback(job, convex);
  }
  if (meta.seconds > MAX_SECONDS) {
    throw new Error(`This video is ${Math.round(meta.seconds / 60)} min long — the limit is ${MAX_SECONDS / 60} min. Nothing was downloaded.`);
  }
  const minutes = Math.max(1, Math.ceil(meta.seconds / 60));
  const mb720 = meta.estimateBytes720 ? meta.estimateBytes720 / 1e6 : minutes * MB_PER_MIN_720;
  const available = meta.available.filter((q) => ["360", "480", "720", "1080"].includes(q));
  await convex.mutation(api.clips.setChecked, {
    secret,
    sourceId: job.id,
    title: meta.title,
    durationSec: meta.seconds,
    ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}),
    ...(meta.channelName ? { channelName: meta.channelName } : {}),
    ...(available.length ? { availableQualities: available } : {}),
    estimateMb: Math.round(mb720),
    estimateUsd: Math.round((minutes * JOHNVC_PER_MIN + JOHNVC_OVERHEAD) * 100000) / 100000,
  });
  console.log(`[lookup] ${job.id}: ${meta.title} — ${meta.seconds}s`);
}

// ── Download (after the user approves) ──

async function viaJohnvc(job, quality, onWait) {
  const item = await runActor(
    JOHNVC,
    {
      videoUrls: [job.sourceUrl],
      format: "video",
      quality: `${quality}p`,
      videoCodec: "h264",
      maxMinutes: Math.ceil(MAX_SECONDS / 60),
    },
    onWait
  );
  if (!item?.fileUrl) throw new Error(item?.error || item?.reason || item?.note || "johnvc returned no file");
  const minutes = Number(item.chargedMinutes) || Math.ceil((Number(item.durationSeconds) || 0) / 60);
  return {
    actor: JOHNVC,
    downloadUrl: item.fileUrl,
    title: String(item.title ?? job.title ?? "YouTube video"),
    duration: Number(item.durationSeconds) || 0,
    delivered: item.quality ? String(item.quality) : `${quality}p`,
    cost: () => ({ usd: minutes * JOHNVC_PER_MIN + JOHNVC_OVERHEAD, units: minutes }),
  };
}

async function viaMarielise(job, quality, onWait) {
  const item = await runActor(
    MARIELISE,
    { urls: [{ url: job.sourceUrl }], quality, format: "default", residentialProxyMode: "fallback" },
    onWait
  );
  if (!item || item.status !== "success" || !item.downloadUrl) {
    throw new Error(item?.error || item?.errorMessage || "YouTube video could not be downloaded (private, age-restricted or removed?)");
  }
  const duration = Number(item.duration) || 0;
  const minutes = Math.max(1, Math.ceil(duration / 60));
  const delivered = qNum(item.deliveredQuality ?? quality);
  const residentialMb = item.residentialProxyUsed ? (Number(item.fileSizeBytes) || 0) / 1e6 : 0;
  return {
    actor: MARIELISE,
    downloadUrl: item.downloadUrl,
    title: String(item.title ?? "YouTube video"),
    duration,
    delivered: `${delivered}p`,
    cost: () => ({
      usd: minutes * (MARIELISE_PER_MIN[delivered] ?? MARIELISE_PER_MIN["720"]) + residentialMb * RESIDENTIAL_PER_MB,
      units: minutes,
    }),
  };
}

const tooLarge = (e) => /too large|lower quality/i.test(e instanceof Error ? e.message : String(e));

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

export async function downloadLinkSource({ convex, secret, job }) {
  const onWait = (i) =>
    convex
      .mutation(api.clips.setStep, { secret, sourceId: job.id, step: "downloading", progress: Math.min(4, 2 + i * 0.1) })
      .catch(() => {});
  const dir = await mkdtemp(join(tmpdir(), `dl-${job.id}-`));
  try {
    console.log(`[download] ${job.id}: ${job.sourceUrl}`);
    const length = job.durationSec ?? null;
    if (length !== null && length > MAX_SECONDS) throw new Error(`Videos longer than ${MAX_SECONDS / 60} min aren't supported`);
    const picked = ["1080", "720", "480", "360"].includes(job.downloadQuality) ? job.downloadQuality : "720";

    // 1. johnvc at the picked quality (it already falls back to the best quality below).
    let found;
    let lastError;
    try {
      found = await viaJohnvc(job, picked, onWait);
    } catch (e) {
      lastError = e;
      console.warn(`[download] ${job.id}: johnvc failed (${e instanceof Error ? e.message : e}); trying marielise.dev`);
    }
    // 2. marielise.dev from the picked quality down (only steps down on "too large").
    if (!found) {
      const ladder = ["1080", "720", "480", "360"];
      for (const q of ladder.slice(ladder.indexOf(picked))) {
        try {
          found = await viaMarielise(job, q, onWait);
          break;
        } catch (e) {
          lastError = e;
          if (!tooLarge(e)) break;
          console.warn(`[download] ${job.id}: marielise too large at ${q}p, trying lower`);
        }
      }
    }
    if (!found) throw lastError ?? new Error("Download failed");
    if (!found.duration && length) found.duration = length;

    // 3. Download the MP4 to disk.
    const path = join(dir, "source.mp4");
    const res = await fetch(found.downloadUrl);
    if (!res.ok || !res.body) throw new Error(`Could not fetch the downloaded video (${res.status})`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
    const { size } = await stat(path);
    const { usd, units } = found.cost(size);
    recordCost(convex, job, found.actor, usd, units, "clips.youtubeDownload");
    if (size < 1000) throw new Error("Downloaded file is empty");
    if (size > MAX_BYTES) throw new Error("Video is larger than 4 GB");
    if (found.duration > MAX_SECONDS) throw new Error(`Videos longer than ${MAX_SECONDS / 60} min aren't supported`);

    // 4. Copy into R2 at the source's key.
    const { putUrl } = await convex.mutation(api.clips.downloadTarget, { secret, sourceId: job.id });
    await putFile(putUrl, path, size);
    const { videoUrl } = await convex.mutation(api.clips.setDownloaded, {
      secret,
      sourceId: job.id,
      title: found.title,
      sizeBytes: size,
      ...(found.duration ? { durationSec: found.duration } : {}),
    });
    console.log(`[download] ${job.id}: via ${found.actor} at ${found.delivered}, ${(size / 1e6).toFixed(1)} MB, $${usd.toFixed(5)}`);
    return { videoUrl, title: found.title };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
