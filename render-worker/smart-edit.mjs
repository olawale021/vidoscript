// Smart edit generation for one clip (Phase 3). Produces a SmartEdit
// (types/clip.ts) — all times in source seconds:
//   - silences: deterministic, from word timestamps
//   - reframe: face tracking (face-track.mjs), skipped for 16:9
//   - fillers/repeats, zooms, highlights/emojis, B-roll, hook, CTA: one Gemini call
//   - stock B-roll: resolved on Pexels when PEXELS_API_KEY is set

import { GoogleGenerativeAI } from "@google/generative-ai";
import { api } from "../convex/_generated/api.js";
import { trackFaces } from "./face-track.mjs";
import { withAiRetry } from "./report.mjs";

const GEMINI_MODEL = "gemini-2.5-flash";
const PRICE = { input: 0.3, output: 2.5 }; // per 1M tokens — keep in sync with lib/ai-pricing.ts

const SILENCE_MIN = 0.45; // gaps longer than this are cut
const SILENCE_PAD = 0.12; // breathing room kept on each side

// Cutaway templates the AI may use, with required props (subset of types/broll.ts).
const TEMPLATES = {
  TitleCard: { required: ["title"], doc: "{ title, subtitle? }" },
  BigStat: { required: ["value", "label"], doc: "{ value: number, label, prefix?, suffix? }" },
  Comparison: { required: ["left", "right"], doc: "{ left: {label, value}, right: {label, value}, metric? }" },
  BulletList: { required: ["items"], doc: "{ items: string[2-4], title? }" },
  Quote: { required: ["quote"], doc: "{ quote, attribution? }" },
  Reveal: { required: ["lines"], doc: "{ lines: string[1-3] }" },
  Typewriter: { required: ["text"], doc: "{ text }" },
  GlitchText: { required: ["text"], doc: "{ text }" },
  Timeline: { required: ["start", "end", "label"], doc: "{ start: number, end: number, label }" },
  Pipeline: { required: ["steps"], doc: "{ steps: string[3-5] }" },
  DonutChart: { required: ["value", "label"], doc: "{ value: 0-100, label }" },
};

const COLORS = ["#FFE600", "#22D3EE", "#F472B6", "#4ADE80", "#FB923C"];

let idSeq = 0;
const nid = (p) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
const r2 = (n) => Math.round(n * 100) / 100;

export function silenceRemovals(words, start, end) {
  const out = [];
  const sorted = [...words].sort((a, b) => a.s - b.s);
  const edges = [{ e: start }, ...sorted, { s: end }];
  for (let i = 1; i < edges.length; i++) {
    const gapS = edges[i - 1].e;
    const gapE = edges[i].s;
    if (gapS === undefined || gapE === undefined) continue;
    if (gapE - gapS > SILENCE_MIN) {
      const s = gapS + SILENCE_PAD;
      const e = gapE - SILENCE_PAD;
      if (e - s > 0.15) out.push({ id: nid("sil"), s: r2(s), e: r2(e), reason: "silence", enabled: true });
    }
  }
  return out;
}

function buildPrompt(job) {
  const lines = job.words.map((w, i) => `${i}\t${w.s.toFixed(2)}\t${w.w}`).join("\n");
  const catalog = Object.entries(TEMPLATES)
    .map(([k, v]) => `- ${k} props ${v.doc}`)
    .join("\n");
  return `You are an expert short-form video editor (TikTok / Reels / Shorts). Plan edits for ONE clip.

Clip title: ${job.title}
Clip runs from ${job.start.toFixed(2)}s to ${job.end.toFixed(2)}s of the source.
Words (index, start seconds, word):
${lines}

Return ONLY JSON:
{
  "fillers": [{"from": wordIndex, "to": wordIndex, "reason": "filler"|"repeat"}],
  "zooms": [{"word": wordIndex, "seconds": 1.5-3, "scale": 1.1-1.25}],
  "highlights": [{"word": wordIndex, "emoji": "single emoji or null"}],
  "broll": [{"word": wordIndex, "seconds": 2-4, "kind": "template"|"stock", "template": name, "props": {...}, "query": "stock search phrase", "prompt": "AI video prompt for this moment"}],
  "hook": "max 8 words, scroll-stopping title shown in the first 2.5 s",
  "cta": "max 6 words call to action for the end, e.g. 'Follow for part 2'",
  "theme": "hype"|"tech"|"editorial"|"warm"
}

Rules:
- fillers: only clear filler words (um, uh, like as filler, you know), false starts and repeated words/phrases. Never cut meaningful words. Empty list if none.
- zooms: 2-5 moments that deserve emphasis (punchlines, key claims, numbers). Spread them out.
- highlights: 3-8 key words (numbers, strong nouns/verbs). Emoji only where it clearly fits; null otherwise.
- broll: 1-3 cutaways where a visual helps (a number -> BigStat, a list -> BulletList, a contrast -> Comparison, scenery/atmosphere -> stock with a concrete query). Never in the first 2 seconds. Never invent statistics: only use numbers that are spoken.
- Every broll item also gets "prompt": a 1–2 sentence text-to-video prompt (max 45 words) showing a concrete scene that illustrates what is said there — subject, setting, lighting, one camera move; cinematic, realistic; no text, logos or celebrity faces.
- Templates you may use:
${catalog}
- No markdown, no commentary.`;
}

async function resolveStock(query, aspect) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const orientation = aspect === "16:9" ? "landscape" : aspect === "1:1" ? "square" : "portrait";
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=6&orientation=${orientation}`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const v = data.videos?.[0];
  if (!v) return null;
  const mp4 = (v.video_files ?? []).filter((f) => f.file_type === "video/mp4" && (f.height ?? 0) >= 480);
  mp4.sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  const file = mp4.find((f) => (f.height ?? 0) >= 1000) ?? mp4[mp4.length - 1];
  return file ? { url: file.link, credit: v.user?.name ?? "Pexels" } : null;
}

async function aiPass(job, convex) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set for the worker");
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });
  const result = await withAiRetry(() =>
    model.generateContent({ contents: [{ role: "user", parts: [{ text: buildPrompt(job) }] }] })
  );
  const u = result.response.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) {
    convex
      .mutation(api.usage.record, {
        secret,
        userId: job.userId,
        provider: "gemini",
        model: GEMINI_MODEL,
        feature: "clips.smartEdit",
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * PRICE.input + outputTokens * PRICE.output) / 1_000_000,
      })
      .catch(() => {});
  }
  try {
    return JSON.parse(result.response.text());
  } catch {
    return {};
  }
}

export async function generateSmartEdit({ convex, job }) {
  const words = [...job.words].sort((a, b) => a.s - b.s);
  const W = (i) => (Number.isInteger(i) && i >= 0 && i < words.length ? words[i] : null);

  // 1. Silences (deterministic).
  const removals = silenceRemovals(words, job.start, job.end);

  // 2. Face tracking (vertical/square only).
  let reframe = { enabled: false, track: [], srcAspect: null };
  if (job.aspect !== "16:9") {
    try {
      const f = await trackFaces(job.sourceUrl, job.start, job.end);
      reframe = { enabled: f.track.length > 0, track: f.track, srcAspect: f.srcAspect };
      console.log(`[smart] ${job.id}: face in ${f.faceFrames}/${f.frames} frames, ${f.track.length} keyframes`);
    } catch (e) {
      console.warn(`[smart] ${job.id}: face tracking failed:`, e instanceof Error ? e.message : e);
    }
  }

  // 3. AI pass.
  const ai = words.length ? await aiPass({ ...job, words }, convex) : {};

  for (const f of Array.isArray(ai.fillers) ? ai.fillers : []) {
    const a = W(f.from);
    const b = W(f.to ?? f.from);
    if (!a || !b || b.e < a.s || b.e - a.s > 4) continue;
    removals.push({ id: nid("fil"), s: r2(a.s - 0.02), e: r2(b.e + 0.02), reason: f.reason === "repeat" ? "repeat" : "filler", enabled: true });
  }

  const zooms = (Array.isArray(ai.zooms) ? ai.zooms : [])
    .map((z) => ({ w: W(z.word), z }))
    .filter(({ w }) => w)
    .slice(0, 6)
    .map(({ w, z }) => ({
      id: nid("zm"),
      t: r2(w.s),
      dur: r2(Math.max(1, Math.min(4, Number(z.seconds) || 2))),
      scale: r2(Math.max(1.05, Math.min(1.3, Number(z.scale) || 1.15))),
      enabled: true,
    }));

  const highlights = (Array.isArray(ai.highlights) ? ai.highlights : [])
    .map((h, i) => ({ w: W(h.word), h, i }))
    .filter(({ w }) => w)
    .slice(0, 10)
    .map(({ w, h, i }) => ({
      id: nid("hl"),
      t: r2(w.s),
      word: w.w,
      color: COLORS[i % COLORS.length],
      emoji: typeof h.emoji === "string" && h.emoji.trim() && [...h.emoji.trim()].length <= 3 ? h.emoji.trim() : null,
      enabled: true,
    }));

  const broll = [];
  for (const b of (Array.isArray(ai.broll) ? ai.broll : []).slice(0, 3)) {
    const w = W(b.word);
    if (!w || w.s < job.start + 1.5) continue;
    const dur = r2(Math.max(1.5, Math.min(4, Number(b.seconds) || 2.5)));
    const shotPrompt = typeof b.prompt === "string" && b.prompt.trim() ? b.prompt.trim().slice(0, 600) : undefined;
    if (b.kind === "stock" && typeof b.query === "string" && b.query.trim()) {
      const asset = await resolveStock(b.query.trim(), job.aspect).catch(() => null);
      broll.push({
        id: nid("br"), t: r2(w.s), dur, kind: "stock", query: b.query.trim(),
        assetUrl: asset?.url ?? null, assetType: "video", credit: asset?.credit ?? null,
        prompt: shotPrompt,
        enabled: !!asset,
      });
    } else if (TEMPLATES[b.template] && b.props && typeof b.props === "object") {
      const ok = TEMPLATES[b.template].required.every((k) => b.props[k] !== undefined && b.props[k] !== null && b.props[k] !== "");
      if (ok) broll.push({ id: nid("br"), t: r2(w.s), dur, kind: "template", template: b.template, props: b.props, prompt: shotPrompt, enabled: true });
    }
  }

  const hookText = typeof ai.hook === "string" && ai.hook.trim() ? ai.hook.trim().slice(0, 80) : job.hook?.slice(0, 80) ?? "";
  const ctaText = typeof ai.cta === "string" ? ai.cta.trim().slice(0, 60) : "";
  const theme = ["hype", "tech", "editorial", "warm"].includes(ai.theme) ? ai.theme : "tech";

  return {
    version: 1,
    reframe,
    removals: removals.sort((a, b) => a.s - b.s),
    zooms,
    highlights,
    broll,
    hook: { enabled: !!hookText, text: hookText, durationSec: 2.5 },
    anim: { progressBar: true, cutPunch: true, endCta: { enabled: !!ctaText, text: ctaText } },
    theme,
  };
}
