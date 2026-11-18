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

const MAX_SECONDS = 3 * 60 * 60; // 3 hours
const MAX_BYTES = 6 * 1024 ** 3;
const RUN_CAP_USD = 2; // hard cap per Apify run (maxTotalChargeUsd)

// USD (Apify FREE tier, Nov 2026)
const JOHNVC_PER_MIN = 0.000011;
const JOHNVC_OVERHEAD = 0.00002; // actor start + dataset row
const MARIELISE_PER_MIN = { "360": 0.01, "480": 0.015, "720": 0.02, "1080": 0.03 };
const RESIDENTIAL_PER_MB = 0.05;
const LOOKUP_FALLBACK_USD = 0.004;
const MB_PER_MIN_720 = 16; // measured: a 63-min video was 1,044 MB at 720p

// Apify's API sometimes returns a 502/503/504 (or the connection drops) for a
// moment. Read requests (GET: polling a run, fetching results) are retried with
// backoff; starting a run (POST) is not, since a retry could start a second,
// paid download.
const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

async function apify(path, init = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set for the worker");
  const retryable = (init.method ?? "GET") === "GET";
  const where = path.split("?")[0];
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.apify.com/v2${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (e) {
      if (retryable && attempt < RETRY_DELAYS_MS.length) {
        console.warn(`[download] Apify ${where}: network error, retrying (${e instanceof Error ? e.message : e})`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw new Error("Couldn't reach the video downloader (Apify). Please click Retry in a minute.");
    }
    if (res.ok) return res.json();
    if (retryable && TRANSIENT.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
      console.warn(`[download] Apify ${where}: ${res.status}, retrying`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      continue;
    }
    if (TRANSIENT.has(res.status)) {
      throw new Error(`The video downloader (Apify) is having a temporary problem (${res.status}). Please click Retry in a few minutes.`);
    }
    // Plain-text detail only (some errors come back as HTML pages).
    const detail = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(`Apify ${where} failed (${res.status}): ${detail}`);
  }
}

// Read the run's log to tell the user what's happening (the actors don't
// report progress any other way). johnvc logs "attempt 4/6 status=blocked";
// yt-dlp logs "[download]  45.3% of ~690.00MiB".
async function runInsight(runId) {
  const token = process.env.APIFY_TOKEN;
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/log`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res?.ok) return null;
  const text = await res.text();
  const lines = text.trim().split("\n").filter(Boolean);
  const lastTs = [...lines].reverse().map((l) => Date.parse(l.slice(0, 24))).find((t) => Number.isFinite(t)) ?? null;
  const attempt = [...text.matchAll(/attempt (\d+)\/(\d+) status=(\w+)/g)].pop();
  const pct = [...text.matchAll(/\[download\]\s+([\d.]+)% of\s+~?\s*([\d.]+)\s*(KiB|MiB|GiB)/g)].pop();
  const unit = { KiB: 1 / 1024, MiB: 1, GiB: 1024 };
  return {
    lastActivity: lastTs,
    attempt: attempt ? { n: Number(attempt[1]), of: Number(attempt[2]), status: attempt[3] } : null,
    pct: pct ? Number(pct[1]) : null,
    totalMb: pct ? Math.round(Number(pct[2]) * unit[pct[3]] * 1.048576) : null,
    retrying: (text.match(/trying next fallback/g) ?? []).length,
  };
}

const STALL_MS = 6 * 60 * 1000; // a working attempt can be silent ~4 min

function describe(insight, elapsedSec) {
  const mmss = `${Math.floor(elapsedSec / 60)}:${String(Math.floor(elapsedSec % 60)).padStart(2, "0")}`;
  if (insight?.pct !== null && insight?.pct !== undefined) {
    const done = insight.totalMb ? ` (${Math.round((insight.totalMb * insight.pct) / 100)} of ${insight.totalMb} MB)` : "";
    return { text: `Downloading on Apify: ${Math.round(insight.pct)}%${done}`, frac: insight.pct / 100 };
  }
  if (insight?.attempt && insight.attempt.status !== "ok") {
    return {
      text: `YouTube is blocking the download, trying route ${insight.attempt.n} of ${insight.attempt.of}… (${mmss})`,
      frac: null,
    };
  }
  if (insight?.retrying) return { text: `Retrying a different way (${insight.retrying + 1})… (${mmss})`, frac: null };
  return { text: `Downloading on Apify… (${mmss})`, frac: null };
}

async function runActor(actor, input, onWait = async () => {}) {
  let run = (
    await apify(`/acts/${actor}/runs?waitForFinish=15&maxTotalChargeUsd=${RUN_CAP_USD}`, {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).data;
  const started = Date.now();
  for (let i = 0; run.status === "RUNNING" || run.status === "READY"; i++) {
    if (Date.now() - started > 2 * 60 * 60 * 1000) throw new Error("Download timed out");
    const insight = await runInsight(run.id);
    const elapsed = (Date.now() - started) / 1000;
    // Nothing logged for a long time: the run is stuck (usually YouTube
    // blocking it). Abort it so the next downloader gets a turn.
    if (insight?.lastActivity && Date.now() - insight.lastActivity > STALL_MS && elapsed > STALL_MS / 1000) {
      await apify(`/actor-runs/${run.id}/abort`, { method: "POST" }).catch(() => {});
      throw new Error("The downloader stalled (YouTube was blocking it)");
    }
    await onWait(describe(insight, elapsed));
    run = (await apify(`/actor-runs/${run.id}?waitForFinish=15`)).data;
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

// residential: "fallback" lets it use the paid residential proxy ($0.05/MB)
// once free routes are blocked. Every run is capped at RUN_CAP_USD ($2): a
// download that would cost more fails instead (the user's rule).
async function viaMarielise(job, quality, onWait, { residential = "fallback" } = {}) {
  const item = await runActor(
    MARIELISE,
    { urls: [{ url: job.sourceUrl }], quality, format: "default", residentialProxyMode: residential },
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

const RETRY_PAUSE_SEC = Number(process.env.DOWNLOAD_RETRY_PAUSE_SEC) || 120;

// Every downloader failed at the picked quality (usually YouTube blocking).
// The worker sends the video back to the quality picker instead of failing.
export class QualityBlockedError extends Error {
  constructor(quality, mode = "auto") {
    const tried = { auto: "the main and backup downloaders", main: "the main downloader", backup: "the backup downloader", premium: "the backup downloader with the premium proxy" }[mode];
    super(`YouTube blocked ${tried} at ${quality}p. Choose how to try next: wait and retry, another downloader, or a lower quality.`);
    this.code = "QUALITY_BLOCKED";
  }
}


// PUT a file to a presigned R2 URL with an explicit Content-Length (streamed).
function putFile(url, path, size, onBytes = () => {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": size } }, (res) => {
      res.resume();
      res.on("end", () =>
        res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error(`Upload to R2 failed (${res.statusCode})`))
      );
    });
    req.on("error", reject);
    let sent = 0;
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      sent += chunk.length;
      onBytes(sent);
    });
    stream.pipe(req);
  });
}

export async function downloadLinkSource({ convex, secret, job }) {
  const report = (detail, progress) =>
    convex.mutation(api.clips.setStep, { secret, sourceId: job.id, step: "downloading", progress, detail }).catch(() => {});
  let downloader = "";
  const onWait = ({ text, frac }) => report(`${downloader}${text}`, frac !== null ? 1 + frac * 11 : 2);
  // Report byte progress at most every 3 s.
  const throttled = (fn) => {
    let last = 0;
    return (...args) => {
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      fn(...args);
    };
  };
  const dir = await mkdtemp(join(tmpdir(), `dl-${job.id}-`));
  try {
    console.log(`[download] ${job.id}: ${job.sourceUrl}`);
    const length = job.durationSec ?? null;
    if (length !== null && length > MAX_SECONDS) throw new Error(`Videos longer than ${MAX_SECONDS / 60} min aren't supported`);
    const picked = ["1080", "720", "480", "360"].includes(job.downloadQuality) ? job.downloadQuality : "720";

    // Only the quality the user picked is ever tried; a lower one is never
    // swapped in silently (the user decides, see QualityBlockedError).
    // 1. johnvc (cheap) → 2. marielise.dev backup → 3. johnvc again after a pause
    //    (YouTube's blocking often clears within minutes).
    let found;
    let lastError;
    const attempt = async (label, fn) => {
      try {
        found = await fn();
      } catch (e) {
        lastError = e;
        console.warn(`[download] ${job.id}: ${label} failed (${e instanceof Error ? e.message : e})`);
      }
    };
    const mode = job.downloader ?? "auto";
    if (mode === "main") {
      await report("Main downloader…", 1);
      await attempt("johnvc", () => viaJohnvc(job, picked, onWait));
    } else if (mode === "backup") {
      downloader = "Backup downloader · ";
      await report(`${downloader}starting…`, 1);
      await attempt("marielise", () => viaMarielise(job, picked, onWait, { residential: "disabled" }));
    } else if (mode === "premium") {
      downloader = "Backup + premium proxy · ";
      await report(`${downloader}starting…`, 1);
      await attempt("marielise premium", () => viaMarielise(job, picked, onWait, { residential: "fallback" }));
    } else {
      await report("Starting the downloader…", 1);
      await attempt("johnvc", () => viaJohnvc(job, picked, onWait));
      if (!found) {
        downloader = "Backup downloader · ";
        await report(`${downloader}starting…`, 2);
        await attempt("marielise", () => viaMarielise(job, picked, onWait));
      }
      if (!found) {
        downloader = "";
        for (let s = RETRY_PAUSE_SEC; s > 0; s -= 15) {
          await report(`YouTube is blocking ${picked}p downloads right now. Trying again in ${Math.ceil(s / 60)} min…`, 2);
          await new Promise((r) => setTimeout(r, 15000));
        }
        downloader = "Second try · ";
        await attempt("johnvc (second try)", () => viaJohnvc(job, picked, onWait));
      }
    }
    // A video that can't be downloaded at all, or a setup problem (bad key),
    // is a real failure; anything else is treated as YouTube blocking.
    const hardFail = /\bprivate\b|\bremoved\b|age-restricted|members-only|\blive stream\b|\(40[13]\)|token/i;
    if (!found && !hardFail.test(String(lastError?.message ?? ""))) {
      throw new QualityBlockedError(picked, mode);
    }
    if (!found) throw lastError ?? new Error("Download failed");
    if (!found.duration && length) found.duration = length;

    // 3. Download the MP4 to disk.
    const path = join(dir, "source.mp4");
    const res = await fetch(found.downloadUrl);
    if (!res.ok || !res.body) throw new Error(`Could not fetch the downloaded video (${res.status})`);
    const total = Number(res.headers.get("content-length")) || 0;
    let got = 0;
    const fetchProgress = throttled(() =>
      report(
        total
          ? `Copying to our server: ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB`
          : `Copying to our server: ${Math.round(got / 1e6)} MB`,
        total ? 12 + (got / total) * 5 : 13
      )
    );
    const body = Readable.fromWeb(res.body);
    body.on("data", (chunk) => {
      got += chunk.length;
      fetchProgress();
    });
    await pipeline(body, createWriteStream(path));
    const { size } = await stat(path);
    const { usd, units } = found.cost(size);
    recordCost(convex, job, found.actor, usd, units, "clips.youtubeDownload");
    if (size < 1000) throw new Error("Downloaded file is empty");
    if (size > MAX_BYTES) throw new Error("Video is larger than 6 GB. Pick a lower quality.");
    if (found.duration > MAX_SECONDS) throw new Error(`Videos longer than ${MAX_SECONDS / 60} min aren't supported`);

    // 4. Copy into R2 at the source's key.
    const { putUrl } = await convex.mutation(api.clips.downloadTarget, { secret, sourceId: job.id });
    const saveProgress = throttled((sent) =>
      report(`Saving to storage: ${Math.round(sent / 1e6)} of ${Math.round(size / 1e6)} MB`, 17 + (sent / size) * 2)
    );
    await putFile(putUrl, path, size, saveProgress);
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
