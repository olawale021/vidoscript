// Clip ingest pipeline, run by the render worker for each queued clip source:
//   1. extract a small mono MP3 from the source video in R2 (ffmpeg reads the signed URL)
//   2. transcribe it with Whisper in ~20-minute chunks (word timestamps)
//   3. ask Gemini for the best short clips, then snap cut points to word boundaries
// Progress, transcript and clips are written back to Convex (convex/clips.ts).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";

// Prefer the system ffmpeg in Docker (FFMPEG_PATH); ffmpeg-static locally.
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
import OpenAI, { toFile } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { api } from "../convex/_generated/api.js";
import { withAiRetry } from "./report.mjs";

const CHUNK_SECONDS = 20 * 60;
const GEMINI_MODEL = "gemini-2.5-flash";

// Keep in sync with lib/ai-pricing.ts (USD).
const PRICES = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 }, // per 1M tokens
  whisperPerMinute: 0.006,
  groqWhisperPerHour: 0.04, // whisper-large-v3-turbo, 10 s minimum per request
};

function runFfmpeg(args, onTime) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      const text = d.toString();
      stderr = (stderr + text).slice(-20_000);
      const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && onTime) onTime(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.split("\n").slice(-4).join(" ").trim()}`));
    });
  });
}

function parseDuration(stderr) {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

const round = (n) => Math.round(n * 100) / 100;

function recordUsage(convex, userId, row) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return;
  convex.mutation(api.usage.record, { secret, userId, ...row }).catch((e) => {
    console.warn("[clips] usage record failed:", e instanceof Error ? e.message : e);
  });
}

// ── Clip finder ──

const FINDER_PROMPT = `You are a short-form video editor. From the timestamped transcript of a long video, pick the moments that will work best as standalone vertical clips (TikTok, Reels, Shorts).

Rules:
- Each clip must make sense on its own, with no missing context.
- Start on a strong hook: the first sentence should grab attention.
- End on a complete thought, not mid-sentence.
- Length 15–90 seconds; 30–60 is ideal.
- Clips must not overlap each other or any "already chosen" clip listed below.
- Spread clips across the whole video, not just the start.
- Use the [start-end] timestamps (seconds) from the transcript lines for start and end.

Return ONLY a JSON array, best first. Each item:
{"start": number, "end": number, "title": "short title, max 8 words", "hook": "the opening line or a rewritten scroll-stopping hook", "reason": "one sentence on why it works", "score": integer 0-100 (how likely it performs)}`;

// How many clips to aim for: one per ~6 minutes, 3..20 (1 hour → 10, 2 hours → 20).
export function targetClipCount(durationSec) {
  const d = durationSec ?? 0;
  if (d < 180) return d < 90 ? 1 : 2; // very short videos: 1–2 clips
  return Math.max(3, Math.min(20, Math.round(d / 360)));
}

// Sentence-ish transcript lines from words (used when re-finding from a saved
// transcript, which keeps words but not Whisper's segments).
export function segmentsFromWords(words) {
  const segs = [];
  let cur = [];
  const flush = () => {
    if (cur.length) segs.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" ") });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.s - prev.e > 0.7 || cur.length >= 30)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.w) && cur.length >= 6) flush();
  }
  flush();
  return segs;
}

function preferenceBlock(prefs) {
  if (!prefs || (!prefs.liked.length && !prefs.disliked.length)) return "";
  const fmt = (c) =>
    `- "${c.title}" (${c.seconds}s)${c.reasons.length ? ` [${c.reasons.join(", ")}]` : ""}${c.note ? ` (their words: "${c.note}")` : ""}: ${c.text}`;
  return `\n\nThis creator has rated clips from their earlier videos. Learn WHAT KIND of moment they like — hook strength, energy, humour, pacing, length, story shape, how self-contained it is — and pick moments of that kind from THIS video's own content. Don't look for the same topics or names as the examples (they may be from different videos), and avoid the kinds of moment they DISLIKED, respecting the reasons given:
${prefs.liked.length ? `LIKED:\n${prefs.liked.map(fmt).join("\n")}` : ""}
${prefs.disliked.length ? `DISLIKED:\n${prefs.disliked.map(fmt).join("\n")}` : ""}`;
}

function snapClips(raw, words, duration, existing = [], limit = 10) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const start = Number(c?.start);
    const end = Number(c?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // First word starting near/after start, last word ending near/before end.
    const first = words.find((w) => w.s >= start - 0.5);
    const lastIdx = words.findLastIndex((w) => w.e <= end + 0.5);
    if (!first || lastIdx < 0) continue;
    const last = words[lastIdx];
    if (last.e <= first.s) continue;
    const s = round(Math.max(0, first.s - 0.15));
    const e = round(Math.min(duration ?? last.e + 1, last.e + 0.25));
    const len = e - s;
    if (len < 5 || len > 120) continue;
    const text = words
      .filter((w) => w.s >= first.s && w.e <= last.e)
      .map((w) => w.w)
      .join(" ")
      .replace(/\s+([,.!?;:])/g, "$1");
    out.push({
      start: s,
      end: e,
      title: String(c.title ?? "Untitled clip").slice(0, 100),
      hook: String(c.hook ?? "").slice(0, 300),
      reason: String(c.reason ?? "").slice(0, 300),
      score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))),
      text: text.slice(0, 5000),
    });
  }
  // Drop overlaps (with each other and with clips already chosen), keeping the higher-scored clip.
  out.sort((a, b) => b.score - a.score);
  const kept = [];
  const clear = (c, list) => list.every((k) => c.end <= k.start + 1 || c.start >= k.end - 1);
  for (const c of out) {
    if (clear(c, kept) && clear(c, existing)) kept.push(c);
  }
  return kept.slice(0, limit);
}

// Long videos are searched in ~30-minute sections so moments late in the video
// get the same attention as the start; candidates are then ranked together.
const WINDOW_SECONDS = 30 * 60;
const WINDOW_FROM = 45 * 60;

function rejectedBlock(rejected) {
  if (!rejected?.length) return "";
  return `\n\nThe creator REJECTED these clips from this video. Do not pick them, and avoid moments with the same problems:\n${rejected
    .map(
      (c) =>
        `- [${c.start.toFixed(1)}-${c.end.toFixed(1)}] ${c.title}${c.reasons.length ? ` — ${c.reasons.join(", ")}` : ""}${c.note ? ` — "${c.note}"` : ""}`
    )
    .join("\n")}`;
}

async function askFinder({ model, convex, userId, transcript, ask, extra, title, duration, section }) {
  const result = await withAiRetry(() =>
    model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `${FINDER_PROMPT}\n- Return exactly ${ask} clips, best first.${extra}\n\nVideo title: ${title}\nVideo length: ${Math.round(duration ?? 0)} seconds${section ? `\nThis is ${section} of the video; timestamps are from the start of the whole video.` : ""}\n\nTranscript:\n${transcript}`,
            },
          ],
        },
      ],
    })
  );
  const u = result.response.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const p = PRICES[GEMINI_MODEL];
  recordUsage(convex, userId, {
    provider: "gemini",
    model: GEMINI_MODEL,
    feature: "clips.findClips",
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * p.input + outputTokens * p.output) / 1_000_000,
  });
  let raw;
  try {
    raw = JSON.parse(result.response.text());
  } catch {
    throw new Error("The AI returned clips in an unreadable format");
  }
  if (raw && !Array.isArray(raw) && Array.isArray(raw.clips)) raw = raw.clips;
  return Array.isArray(raw) ? raw : [];
}

function hintsBlock(hints) {
  if (!hints?.length) return "";
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return `\n\nViewers point to these moments (timestamped comments / most replayed). Check them first and prefer them when they make strong standalone clips; don't force them if they don't:\n${hints
    .map((h) => `- around ${fmt(h.start)}${h.label ? ` — "${h.label}"` : ""}`)
    .join("\n")}`;
}

async function findClips({ segments, words, duration, title, convex, userId, count, existing = [], rejected = [], hints = [] }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set for the worker");
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });
  const prefs = await convex.query(api.clips.preferencesFor, { secret: process.env.BROLL_WORKER_SECRET, userId }).catch(() => null);
  if (prefs && (prefs.liked.length || prefs.disliked.length)) {
    console.log(`[clips] using preferences: ${prefs.liked.length} liked, ${prefs.disliked.length} disliked`);
  }
  const lines = (list) => list.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`).join("\n");
  const already = (list) =>
    list.length
      ? `\n\nAlready chosen (do NOT pick these again or overlap them):\n${list.map((c) => `- [${c.start.toFixed(1)}-${c.end.toFixed(1)}] ${c.title}`).join("\n")}`
      : "";
  const base = `${preferenceBlock(prefs)}${rejectedBlock(rejected)}${hintsBlock(hints)}`;
  if (hints.length) console.log(`[clips] using ${hints.length} scout hints`);
  const total = duration ?? segments[segments.length - 1]?.end ?? 0;

  let raw = [];
  if (total <= WINDOW_FROM) {
    // Ask for a few spares: overlaps and bad timestamps get filtered out below.
    raw = await askFinder({ model, convex, userId, transcript: lines(segments), ask: count + 3, extra: base + already(existing), title, duration });
  } else {
    const n = Math.ceil(total / WINDOW_SECONDS);
    const windows = Array.from({ length: n }, (_, i) => [i * WINDOW_SECONDS, Math.min(total, (i + 1) * WINDOW_SECONDS)]);
    console.log(`[clips] long video (${Math.round(total / 60)} min): searching ${n} sections`);
    const results = await Promise.all(
      windows.map(async ([from, to]) => {
        const seg = segments.filter((s) => s.start >= from && s.start < to);
        if (!seg.length) return [];
        const ask = Math.max(2, Math.ceil((count * (to - from)) / total)) + 1;
        const inWindow = existing.filter((c) => c.end > from && c.start < to);
        const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
        return askFinder({
          model,
          convex,
          userId,
          transcript: lines(seg),
          ask,
          extra: base + already(inWindow),
          title,
          duration,
          section: `the part from ${fmt(from)} to ${fmt(to)}`,
        });
      })
    );
    raw = results.flat();
  }
  return snapClips(raw, words, duration, existing, count);
}

// ── Pipeline ──

export async function processClipSource({ convex, secret, job }) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not set for the worker");
  const openai = new OpenAI({ apiKey: openaiKey });
  const groq = process.env.GROQ_API_KEY
    ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" })
    : null;
  const dir = await mkdtemp(join(tmpdir(), `clip-${job.id}-`));
  const setStep = (step, progress, extra = {}) =>
    convex.mutation(api.clips.setStep, { secret, sourceId: job.id, step, progress, ...extra }).catch(() => {});

  try {
    // "Find more": reuse the saved transcript, keep existing clips, add 5 more.
    if (job.findMore) {
      const t = await convex.query(api.clips.transcriptFor, { secret, sourceId: job.id });
      if (!t.words.length) throw new Error("No saved transcript to find more clips from");
      await setStep("finding", 85);
      // Replacements first (they fill the rejected clips' slots), then "find more".
      const wanted = t.replaceIds.length + t.more;
      const more = wanted
        ? await findClips({
            segments: segmentsFromWords(t.words),
            words: t.words,
            duration: t.durationSec,
            title: job.title,
            convex,
            userId: job.userId,
            count: wanted,
            existing: t.existing,
            rejected: t.rejected,
            hints: job.hints ?? [],
          })
        : [];
      if (more.length === 0 && t.replaceIds.length === 0) throw new Error("No more good clips found in this video");
      await convex.mutation(api.clips.saveClips, {
        secret,
        sourceId: job.id,
        clips: more,
        append: true,
        replaced: t.replaceIds,
        moreDone: t.more,
      });
      console.log(`[clips] ${job.id}: ${t.replaceIds.length} replaced, ${Math.max(0, more.length - t.replaceIds.length)} more`);
      return;
    }

    // 1. Extract audio (mono, 16 kHz, 32 kbps ≈ 14 MB/hour).
    console.log(`[clips] ${job.id}: extracting audio`);
    const audioPath = join(dir, "audio.mp3");
    let duration = null;
    let lastPct = -1;
    const stderr = await runFfmpeg(
      ["-i", job.videoUrl, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", audioPath],
      (t) => {
        const d = duration ?? job.durationSec;
        if (!d) return;
        const pct = Math.min(10, Math.floor((t / d) * 10));
        if (pct !== lastPct) {
          lastPct = pct;
          setStep("extracting", 20 + pct * 0.5, { detail: `${Math.round(t / 60)} of ${Math.round(d / 60)} min` });
        }
      }
    ).catch(async (e) => {
      throw new Error(`Could not read the video's audio. ${e.message}`);
    });
    duration = parseDuration(stderr);
    if ((await stat(audioPath)).size < 1000) throw new Error("The video has no audio track");
    await setStep("transcribing", 25, duration ? { durationSec: round(duration) } : {});

    // 2. Transcribe in chunks.
    const total = duration ?? CHUNK_SECONDS;
    const chunks = Math.max(1, Math.ceil(total / CHUNK_SECONDS));
    const words = [];
    const segments = [];
    for (let i = 0; i < chunks; i++) {
      const offset = i * CHUNK_SECONDS;
      const chunkPath = join(dir, `chunk-${i}.mp3`);
      await runFfmpeg(["-ss", String(offset), "-t", String(CHUNK_SECONDS), "-i", audioPath, "-c", "copy", chunkPath]);
      const file = await toFile(await readFile(chunkPath), `chunk-${i}.mp3`, { type: "audio/mpeg" });
      console.log(`[clips] ${job.id}: transcribing chunk ${i + 1}/${chunks}`);
      if (chunks > 1) await setStep("transcribing", 25 + (i / chunks) * 50, { detail: `Part ${i + 1} of ${chunks}` });
      // Groq whisper-large-v3-turbo first (~9x cheaper), OpenAI whisper-1 as fallback.
      let res;
      let via = "groq";
      try {
        if (!groq) throw new Error("no Groq key");
        res = await groq.audio.transcriptions.create({
          file,
          model: "whisper-large-v3-turbo",
          response_format: "verbose_json",
          timestamp_granularities: ["word", "segment"],
        });
        if (!res.words?.length && res.text?.trim()) throw new Error("Groq returned no word timestamps");
      } catch (e) {
        if (groq) console.warn(`[clips] ${job.id}: Groq failed (${e instanceof Error ? e.message : e}); using OpenAI`);
        via = "openai";
        const fresh = await toFile(await readFile(chunkPath), `chunk-${i}.mp3`, { type: "audio/mpeg" });
        res = await openai.audio.transcriptions.create({
          file: fresh,
          model: "whisper-1",
          response_format: "verbose_json",
          timestamp_granularities: ["word", "segment"],
        });
      }
      const audioSeconds = Number(res.duration ?? 0) || 0;
      recordUsage(convex, job.userId, {
        provider: via,
        model: via === "groq" ? "whisper-large-v3-turbo" : "whisper-1",
        feature: "clips.transcribe",
        inputTokens: 0,
        outputTokens: 0,
        audioSeconds,
        costUsd:
          via === "groq"
            ? (Math.max(10, audioSeconds) / 3600) * PRICES.groqWhisperPerHour
            : (audioSeconds / 60) * PRICES.whisperPerMinute,
      });
      const chunkWords = (res.words ?? []).map((w) => ({
        w: String(w.word),
        s: round(w.start + offset),
        e: round(w.end + offset),
      }));
      words.push(...chunkWords);
      for (const s of res.segments ?? []) {
        segments.push({ start: s.start + offset, end: s.end + offset, text: s.text });
      }
      await convex.mutation(api.clips.saveTranscriptChunk, { secret, sourceId: job.id, chunk: i, words: chunkWords });
      await setStep("transcribing", 25 + ((i + 1) / chunks) * 50);
    }
    if (words.length === 0) throw new Error("No speech was found in this video");

    // 3. Find clips.
    console.log(`[clips] ${job.id}: finding clips (${words.length} words)`);
    await setStep("finding", 80);
    const clips = await findClips({
      segments,
      words,
      duration,
      title: job.title,
      convex,
      userId: job.userId,
      count: targetClipCount(duration),
      hints: job.hints ?? [],
    });
    if (clips.length === 0) throw new Error("The AI didn't find any usable clips in this video");
    await convex.mutation(api.clips.saveClips, { secret, sourceId: job.id, clips });
    console.log(`[clips] ${job.id}: done, ${clips.length} clips`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
