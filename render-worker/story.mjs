// Story Studio jobs (convex/storyWorker.ts claims them):
//   script → Writer (Gemini)            plan  → Director (Gemini, strict JSON)
//   ref    → character / location image still  → shot image + continuity check
//   voice  → narration (OpenAI TTS) + word timings for captions
//   render → Remotion "Story" composition → MP4

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { api } from "../convex/_generated/api.js";
import { getBrowser, resetBrowser } from "./browser.mjs";
import { withAiRetry } from "./report.mjs";

const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";
const TTS_MODEL = "gpt-4o-mini-tts";

// USD — keep in sync with lib/ai-pricing.ts.
const PRICE = {
  text: { input: 0.3, output: 2.5 }, // per 1M tokens
  image: { input: 0.3, output: 30 }, // per 1M tokens (≈ 1290 output tokens = $0.039 / image)
  ttsPerMinute: 0.015,
  groqWhisperPerHour: 0.04, // 10 s minimum per request
};

const CAMERAS = ["push_in", "pull_out", "pan_left", "pan_right", "static"];
const CAMERA_TEXT = {
  push_in: "medium shot, room around the subject",
  pull_out: "close-up framing",
  pan_left: "wide shot with space on both sides",
  pan_right: "wide shot with space on both sides",
  static: "balanced medium-wide shot",
};

const round4 = (n) => Math.round(n * 10000) / 10000;

function recordUsage(convex, userId, row) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return;
  convex.mutation(api.usage.record, { secret, userId, ...row }).catch(() => {});
}

// ── Gemini helpers ──

function geminiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set for the worker");
  return key;
}

async function geminiJson(convex, job, feature, parts) {
  const model = new GoogleGenerativeAI(geminiKey()).getGenerativeModel({
    model: TEXT_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });
  const result = await withAiRetry(() => model.generateContent({ contents: [{ role: "user", parts }] }));
  const u = result.response.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const costUsd = (inputTokens * PRICE.text.input + outputTokens * PRICE.text.output) / 1_000_000;
  recordUsage(convex, job.userId, { provider: "gemini", model: TEXT_MODEL, feature, inputTokens, outputTokens, costUsd });
  let data;
  try {
    data = JSON.parse(result.response.text());
  } catch {
    throw new Error("The AI returned an unreadable answer. Try again.");
  }
  return { data, costUsd };
}

// The image model sometimes returns no picture (finishReason IMAGE_OTHER) for
// a prompt that works on the next try, so retry that case a couple of times.
async function geminiImage(convex, job, feature, parts, aspectRatio) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await geminiImageOnce(convex, job, feature, parts, aspectRatio);
    } catch (e) {
      lastError = e;
      if (!(e instanceof Error) || !e.message.startsWith("The image model returned no picture")) throw e;
      console.warn(`[story] ${job.kind} ${job.shotId ?? job.item?.id ?? ""}: no image (attempt ${attempt + 1}), retrying`);
    }
  }
  throw lastError;
}

async function geminiImageOnce(convex, job, feature, parts, aspectRatio) {
  const res = await withAiRetry(async () => {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
      }),
    });
    if (!r.ok) throw new Error(`Gemini image ${r.status}: ${(await r.text()).slice(0, 400)}`);
    return r.json();
  });
  const u = res.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  const outputTokens = u.candidatesTokenCount ?? 1290;
  const costUsd = (inputTokens * PRICE.image.input + outputTokens * PRICE.image.output) / 1_000_000;
  recordUsage(convex, job.userId, { provider: "gemini", model: IMAGE_MODEL, feature, inputTokens, outputTokens, costUsd });
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) {
    const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? "no image";
    throw new Error(`The image model returned no picture (${why}). Try rewording the description.`);
  }
  return { buf: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType ?? "image/png", costUsd };
}

async function imagePart(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load reference image (${r.status})`);
  const mimeType = r.headers.get("content-type")?.split(";")[0] || "image/png";
  return { inlineData: { mimeType, data: Buffer.from(await r.arrayBuffer()).toString("base64") } };
}

async function upload(convex, secret, job, folder, ext, body, contentType) {
  const { url, key } = await convex.mutation(api.storyWorker.uploadUrl, { secret, jobId: job.jobId, folder, ext });
  const r = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body });
  if (!r.ok) throw new Error(`R2 upload failed (${r.status})`);
  return key;
}

const extOf = (mime) => (mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png");

// ── Learned preferences (convex/storyFeedback.ts → job.prefs) ──

const DEBUG_PREFS = process.env.STORY_DEBUG_PREFS === "1";

function tally(rows, sign) {
  const counts = {};
  for (const r of rows ?? []) {
    if (sign > 0 ? r.rating <= 0 : r.rating >= 0) continue;
    for (const reason of r.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
const fmtTally = (t, n = 5) => t.slice(0, n).map(([r, c]) => (c > 1 ? `${r} ×${c}` : r)).join(", ");

// Writer: liked / disliked scripts, rewrite requests, finished-video verdicts.
function writerPrefs(prefs) {
  const s = prefs?.script ?? [];
  const v = prefs?.video ?? [];
  if (!s.length && !v.length) return "";
  const lines = [];
  const up = fmtTally(tally(s, 1).filter(([r]) => r !== "Asked for a rewrite"));
  const down = fmtTally(tally(s, -1));
  if (up) lines.push(`- Scripts they praised for: ${up}`);
  if (down) lines.push(`- Scripts they disliked for: ${down}`);
  const notes = s.filter((r) => r.note).slice(0, 6).map((r) => `"${r.note}"`);
  if (notes.length) lines.push(`- Things they asked for in rewrites: ${notes.join("; ")}`);
  const vUp = fmtTally(tally(v, 1));
  const vDown = fmtTally(tally(v, -1));
  if (vUp) lines.push(`- Finished videos they liked: ${vUp}`);
  if (vDown) lines.push(`- Finished videos that missed: ${vDown}`);
  const ex = (r) => r.snapshot?.replace(/\n/g, " / ").slice(0, 260);
  const liked = s.filter((r) => r.rating > 0 && !r.implicit && r.snapshot).slice(0, 2);
  const disliked = s.filter((r) => r.rating < 0 && !r.implicit && r.snapshot).slice(0, 2);
  for (const r of liked) lines.push(`- LIKED example: ${ex(r)}`);
  for (const r of disliked) lines.push(`- DISLIKED example: ${ex(r)}`);
  if (!lines.length) return "";
  return `\n\nWhat this creator likes, learned from their feedback on earlier stories. Learn the KIND of story, hook, tone and pacing they like and avoid what they disliked. Never reuse their earlier plots, titles or names:\n${lines.join("\n")}`;
}

// Director: plan + finished-video feedback.
function directorPrefs(prefs) {
  const p = prefs?.plan ?? [];
  const v = prefs?.video ?? [];
  const lines = [];
  const up = fmtTally(tally(p, 1));
  const down = fmtTally(tally(p, -1));
  if (up) lines.push(`- Plans they liked for: ${up}`);
  if (down) lines.push(`- Plans they disliked for: ${down}`);
  const notes = p.filter((r) => r.note).slice(0, 4).map((r) => `"${r.note}"`);
  if (notes.length) lines.push(`- Their notes: ${notes.join("; ")}`);
  const vDown = fmtTally(tally(v, -1));
  if (vDown) lines.push(`- Finished videos that missed: ${vDown}`);
  if (!lines.length) return "";
  return `\n\nThis creator's feedback on earlier plans (adjust shot count, pacing and camera variety to suit them):\n${lines.join("\n")}`;
}

// Pictures: at most 3 short rules. The image model refuses long prompts.
const STILL_RULES = {
  "Text in image": "Absolutely no writing, letters or numbers anywhere.",
  "Too dark": "Keep the scene well lit and easy to read.",
  "Bad anatomy": "Draw hands, faces and bodies with correct anatomy.",
  "Off style": "Stick strictly to the art style.",
  "Boring framing": "Use dynamic framing with depth and a clear focal point.",
  "Wrong setting": "Follow the location reference closely.",
  "Wrong character look": "Follow each character's reference design closely.",
};
function stillRules(prefs) {
  return tally(prefs?.still, -1)
    .filter(([r]) => STILL_RULES[r])
    .slice(0, 3)
    .map(([r]) => STILL_RULES[r]);
}
const strictContinuity = (prefs) => (tally(prefs?.still, -1).find(([r]) => r === "Wrong character look")?.[1] ?? 0) >= 2;

// Voice: delivery tweaks for the TTS instructions.
function voiceTweaks(prefs) {
  const t = Object.fromEntries(tally(prefs?.voice, -1));
  const out = [];
  if ((t["Too fast"] ?? 0) > (t["Too slow"] ?? 0)) out.push("Speak at a slower, relaxed pace with natural pauses.");
  else if ((t["Too slow"] ?? 0) > 0) out.push("Keep a brisk, energetic pace.");
  if (t["Flat / no emotion"]) out.push("Put real emotion and variation into the delivery.");
  if (t["Mispronounced"]) out.push("Pronounce names and unusual words carefully and clearly.");
  return out.join(" ");
}

function logPrefs(job, label, text) {
  if (DEBUG_PREFS && text) console.log(`[story] ${job.kind} prefs (${label}):\n${text}`);
}

// Series episodes (and re-plans) already have a cast with reference pictures.
function castForWriter(cast) {
  if (!cast?.characters?.length) return "";
  return `\n\nThis is an episode of a series. The recurring cast (use them as the main characters, keep their names and personalities):\n${cast.characters
    .map((c) => `- ${c.name}: ${c.look.slice(0, 200)}`)
    .join("\n")}`;
}
function castForDirector(cast) {
  if (!cast || cast.characters.length + cast.locations.length === 0) return "";
  const fmt = (x) => `- id "${x.id}" · ${x.name}${x.voice ? ` · voice ${x.voice}` : ""}: ${x.look}`;
  return `\n\nThese characters and locations ALREADY EXIST with finished reference pictures. Whenever they appear, reuse their exact id, name, voice and look text (copy the look word for word). Only add new characters or locations if the script really needs them.\nCharacters:\n${cast.characters.map(fmt).join("\n")}${
    cast.locations.length ? `\nLocations:\n${cast.locations.map(fmt).join("\n")}` : ""
  }`;
}

// ── script (Writer) ──

function scriptToText({ title, hook, lines }) {
  const body = lines
    .filter((l) => l?.text?.trim())
    .map((l) => `${(l.speaker || "NARRATOR").toUpperCase()}: ${l.text.trim()}`)
    .join("\n");
  return `TITLE: ${title}\nHOOK: ${hook}\n\n${body}`;
}

async function runScript({ convex, secret, job }) {
  const words = Math.round(job.targetSec * 2.4);
  const prompt = `You write narrated short story videos for YouTube Shorts / TikTok / YouTube.

Idea: ${job.idea}
Target length: ${job.targetSec} seconds of voiceover (about ${words} spoken words — stay within ±10%).
Art style of the video: ${job.style}
${job.script && job.notes ? `Current script:\n${job.script}\n\nRewrite it following these notes: ${job.notes}` : job.notes ? `Notes from the creator: ${job.notes}` : ""}

Rules:
- Open with a hook line that makes people stay in the first 3 seconds.
- A clear story: setup, rising tension, a turn, a satisfying or surprising ending.
- Mostly NARRATOR lines; short character dialogue only where it adds drama.
- Every line is spoken aloud: no stage directions, no camera notes, no emojis, no hashtags.
- Concrete and visual: every line should suggest a picture.
- Plain, natural spoken English. Short sentences.${castForWriter(job.cast)}${writerPrefs(job.prefs)}

Return JSON: {"title": "short catchy title", "hook": "on-screen hook text, max 8 words", "lines": [{"speaker": "NARRATOR" or a character's first name, "text": "..."}]}`;
  logPrefs(job, "writer", writerPrefs(job.prefs));
  const { data, costUsd } = await geminiJson(convex, job, "story.script", [{ text: prompt }]);
  if (!Array.isArray(data.lines) || data.lines.length === 0) throw new Error("The AI returned an empty script. Try again.");
  const title = String(data.title || "Untitled story").slice(0, 120);
  const hook = String(data.hook || "").slice(0, 200);
  await convex.mutation(api.storyWorker.saveScript, {
    secret,
    jobId: job.jobId,
    title,
    hook,
    script: scriptToText({ title, hook, lines: data.lines }),
    costUsd: round4(costUsd),
  });
}

// ── plan (Director) ──

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "x";

async function runPlan({ convex, secret, job }) {
  const shotCount = Math.max(4, Math.round(job.targetSec / 5));
  const prompt = `You are the director of a narrated AI story video. Turn the script into a production plan.

SCRIPT:
${job.script}

Art style: ${job.style}
Aim for about ${shotCount} shots (each 3–8 seconds of voiceover).${castForDirector(job.cast)}
Character voices to choose from: ${job.voices.join(", ")} (the narrator uses "${job.narratorVoice}" — give speaking characters different voices).

Return JSON:
{
  "characters": [{"id": "short-slug", "name": "...", "voice": "<one of the voices>",
                  "look": "fixed visual description: age, build, skin tone, face, hair, outfit with exact colours, one distinctive detail"}],
  "locations": [{"id": "short-slug", "name": "...", "look": "fixed visual description: place, time of day, weather, lighting, key objects, colours"}],
  "shots": [{"narration": "the exact words spoken in this shot",
             "speaker": "narrator" or a character id (only for that character's own dialogue),
             "characters": ["ids of characters visible in the picture"],
             "location": "location id or null",
             "camera": one of ${CAMERAS.map((c) => `"${c}"`).join(", ")},
             "image": "what the picture shows at this moment: action, expressions, composition. Name characters; do not re-describe their looks.",
             "motion": "for an AI video made from this picture: ONE clear, simple action (who moves, how) plus the camera move, e.g. 'Oga trots forward and glances back; slow push in'. Keep it physically natural; no new characters, no scene changes."}],
  "musicMood": one of ${["calm", "emotional", "uplifting", "playful", "tense", "mysterious", "epic"].map((m) => `"${m}"`).join(", ")} (background music that fits the whole story)
}

Rules:
- The shots' narration, read in order, must contain every spoken line of the script, word for word (drop only the TITLE and HOOK labels). Split long lines across shots; 6–22 words per shot.
- Only create characters who are seen in 2 or more shots (max 5) and locations used in 2 or more shots (max 5). Ids are lowercase slugs.
- Vary the camera: mix wide and close shots; no more than two identical camera moves in a row.
- Pictures never contain text, captions, speech bubbles, logos or watermarks.
- Keep every picture with a child open, public and well lit: never show a child being led, taken or followed somewhere hidden, narrow, dark or secluded, or alone with an adult or stranger. Show those story moments neutrally (e.g. walking along a busy street) — the narration carries the meaning. (Image safety filters refuse such pictures.)${directorPrefs(job.prefs)}`;
  logPrefs(job, "director", directorPrefs(job.prefs));
  const { data, costUsd } = await geminiJson(convex, job, "story.plan", [{ text: prompt }]);
  const voices = new Set(job.voices);
  const characters = (Array.isArray(data.characters) ? data.characters : []).slice(0, 5).map((c, i) => ({
    id: slug(c.id || c.name) || `c${i}`,
    name: String(c.name || `Character ${i + 1}`).slice(0, 80),
    look: String(c.look || "").slice(0, 800),
    voice: voices.has(c.voice) ? c.voice : job.voices[(i + 1) % job.voices.length],
  }));
  const locations = (Array.isArray(data.locations) ? data.locations : []).slice(0, 5).map((l, i) => ({
    id: slug(l.id || l.name) || `l${i}`,
    name: String(l.name || `Location ${i + 1}`).slice(0, 80),
    look: String(l.look || "").slice(0, 800),
  }));
  const shots = (Array.isArray(data.shots) ? data.shots : [])
    .filter((s) => s && String(s.narration || "").trim())
    .slice(0, 60)
    .map((s) => ({
      narration: String(s.narration).trim().slice(0, 600),
      speaker: typeof s.speaker === "string" ? slug(s.speaker) : "narrator",
      characters: (Array.isArray(s.characters) ? s.characters : []).map(slug),
      location: s.location ? slug(s.location) : null,
      camera: CAMERAS.includes(s.camera) ? s.camera : "push_in",
      imagePrompt: String(s.image || s.narration).slice(0, 1500),
      motionPrompt: String(s.motion || "").slice(0, 800),
    }));
  if (shots.length === 0) throw new Error("The AI returned no shots. Try again.");
  await convex.mutation(api.storyWorker.savePlan, {
    secret,
    jobId: job.jobId,
    characters,
    locations,
    shots,
    ...(typeof data.musicMood === "string" ? { musicMood: data.musicMood } : {}),
    costUsd: round4(costUsd),
  });
}

// ── ref (Art department: reference images) ──

async function runRef({ convex, secret, job }) {
  const { item, refKind } = job;
  const prompt =
    refKind === "character"
      ? `Character reference image for an illustrated story. Style: ${job.style}.
${item.name}: ${item.look}.
Full body, standing, facing the camera, neutral expression, plain light grey studio background, even soft lighting, the whole outfit clearly visible. Exactly one person. No text, no labels, no watermark.`
      : `Establishing shot of a location for an illustrated story. Style: ${job.style}.
${item.name}: ${item.look}.
No people. No text, no signs with words, no watermark.`;
  const img = await geminiImage(convex, job, "story.image", [{ text: prompt }], refKind === "character" ? "3:4" : job.aspect);
  const key = await upload(convex, secret, job, "refs", extOf(img.mime), img.buf, img.mime);
  await convex.mutation(api.storyWorker.saveRef, { secret, jobId: job.jobId, key, costUsd: round4(img.costUsd) });
}

// ── still (Art department: shot image + continuity check) ──

// Keep this prompt short and the reference wording soft: long prompts, or
// "must look exactly like" a photo-real reference, make the image model refuse
// (finishReason IMAGE_OTHER). The reference images carry the looks.
async function stillParts(job, refs, fix) {
  const hasRef = (name) => refs.some((r) => r.label === name);
  const chars = job.characters.map((c) => (hasRef(c.name) ? c.name : `${c.name} (${c.look})`));
  const loc = job.location ? (hasRef(job.location.name) ? job.location.name : `${job.location.name} (${job.location.look})`) : null;
  const parts = [
    {
      text: [
        `Create one frame of an illustrated story video. Style: ${job.style}. Framing: ${CAMERA_TEXT[job.camera] ?? CAMERA_TEXT.static}.`,
        `Scene: ${job.imagePrompt}`,
        loc ? `Location: ${loc}.` : "",
        chars.length ? `Characters in the frame: ${chars.join(", ")}.` : "",
        refs.length ? "Use the attached reference images as the character design and the setting, keeping the same outfit and colours." : "",
        ...stillRules(job.prefs),
        fix ? `Also fix: ${fix}` : "",
        "No text, captions, speech bubbles, logos or watermarks.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  for (const r of refs) parts.push({ text: `Reference — ${r.label}:` }, r.part);
  return parts;
}

async function continuityCheck(convex, job, refs, img) {
  const charRefs = refs.filter((r) => r.kind === "character");
  if (charRefs.length === 0) return { result: null, costUsd: 0 };
  const parts = [];
  for (const r of charRefs) parts.push({ text: `Reference for ${r.label}:` }, r.part);
  parts.push(
    { text: "Generated story frame:" },
    { inlineData: { mimeType: img.mime, data: img.buf.toString("base64") } },
    {
      text: `Check this frame for continuity with the character references. Characters expected: ${charRefs.map((r) => r.label).join(", ")}.
Judge only what is visible. A hidden face, a silhouette, a back view, a distant figure or a close-up of hands is fine: do not flag missing details.
${strictContinuity(job.prefs) ? "This creator often rejects pictures where a character drifts, so be strict about visible differences.\n" : ""}Flag only a clear contradiction: a visibly different face, hair colour, skin tone, outfit or clothing colour, or the wrong number of people. Ignore pose, angle, lighting and art-style differences.
Return JSON {"ok": true|false, "issue": "short description of the contradiction, empty if ok"}`,
    }
  );
  const { data, costUsd } = await geminiJson(convex, job, "story.check", parts);
  return { result: { ok: data.ok !== false, ...(data.ok === false && data.issue ? { issue: String(data.issue).slice(0, 200) } : {}) }, costUsd };
}

async function runStill({ convex, secret, job }) {
  logPrefs(job, "still rules", stillRules(job.prefs).join(" "));
  const refs = [];
  for (const c of job.characters) if (c.refUrl) refs.push({ kind: "character", label: c.name, part: await imagePart(c.refUrl) });
  if (job.location?.refUrl) refs.push({ kind: "location", label: job.location.name, part: await imagePart(job.location.refUrl) });

  let cost = 0;
  let img;
  let rewrittenPrompt = null;
  try {
    img = await geminiImage(convex, job, "story.image", await stillParts(job, refs), job.aspect);
  } catch (e) {
    if (!isRefusal(e)) throw e;
    // The image model's safety filter refused the description (often a child
    // in a secluded place). Rewrite the same moment safely and draw again.
    const safe = await safeRewrite(convex, job);
    cost += safe.costUsd;
    console.warn(`[story] still ${job.shotId}: refused; retrying with a safer description`);
    try {
      img = await geminiImage(convex, job, "story.image", await stillParts({ ...job, imagePrompt: safe.text }, refs), job.aspect);
    } catch (e2) {
      if (!isRefusal(e2)) throw e2;
      throw new Error(
        "The image model's safety filter refused this picture, even after a safer rewrite. Edit the picture description (make the place open and public, especially with children) and redraw."
      );
    }
    rewrittenPrompt = safe.text;
  }
  cost += img.costUsd;
  let check = await continuityCheck(convex, job, refs, img);
  cost += check.costUsd;
  if (check.result && !check.result.ok) {
    // One automatic retry with the problem spelled out.
    const retry = await geminiImage(convex, job, "story.image", await stillParts(job, refs, check.result.issue), job.aspect);
    cost += retry.costUsd;
    const recheck = await continuityCheck(convex, job, refs, retry);
    cost += recheck.costUsd;
    img = retry;
    check = recheck;
  }
  const key = await upload(convex, secret, job, "stills", extOf(img.mime), img.buf, img.mime);
  await convex.mutation(api.storyWorker.saveStill, {
    secret,
    jobId: job.jobId,
    key,
    continuity: check.result,
    costUsd: round4(cost),
    ...(rewrittenPrompt ? { imagePrompt: rewrittenPrompt } : {}),
  });
}

const isRefusal = (e) => e instanceof Error && e.message.startsWith("The image model returned no picture");

async function safeRewrite(convex, job) {
  const { data, costUsd } = await geminiJson(convex, job, "story.plan", [
    {
      text: `An image model's safety filter refused this picture description from an illustrated story:
"${job.imagePrompt}"
Story line for this shot: "${job.narration}"
Characters: ${job.characters.map((c) => `${c.name} (${c.look.slice(0, 120)})`).join("; ") || "none"}

Rewrite the picture description so it shows the same story moment in a way no safety filter could misread: open, public, well-lit places; no child being led, taken or followed somewhere hidden, narrow, dark or secluded; no child alone with an adult or stranger; no injury, nudity, bathing or sleeping children. Keep the same characters, location, mood and action as closely as possible. One or two sentences, no text in the image.
Return JSON {"description": "..."}`,
    },
  ]);
  const text = String(data.description ?? "").trim().slice(0, 1500);
  if (!text) throw new Error("The image model refused this picture. Edit the picture description and redraw.");
  return { text, costUsd };
}

// ── voice ──

function audioDuration(path) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-i", path, "-f", "null", "-"]);
    let err = "";
    proc.stderr.on("data", (d) => (err = (err + d).slice(-20000)));
    proc.on("error", reject);
    proc.on("close", () => {
      const all = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
      const m = all ?? err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error("Could not read the voiceover length"));
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

// Caption timings: Groq word timestamps when they line up with the script,
// otherwise spread the words over the audio by length.
function alignWords(text, duration, whisper) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (whisper?.length === tokens.length) {
    return tokens.map((w, i) => ({ w, s: whisper[i].start, e: Math.max(whisper[i].end, whisper[i].start + 0.05) }));
  }
  const start = whisper?.[0]?.start ?? 0.05;
  const end = whisper?.length ? whisper[whisper.length - 1].end : Math.max(start + 0.5, duration - 0.1);
  const weight = (w) => w.length + 2 + (/[.!?]$/.test(w) ? 6 : /[,;:]$/.test(w) ? 3 : 0);
  const total = tokens.reduce((s, w) => s + weight(w), 0) || 1;
  let t = start;
  return tokens.map((w) => {
    const d = ((end - start) * weight(w)) / total;
    const word = { w, s: t, e: t + d * 0.85 };
    t += d;
    return word;
  });
}

async function runVoice({ convex, secret, job }) {
  logPrefs(job, "voice", voiceTweaks(job.prefs));
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set for the worker");
  const openai = new OpenAI();
  const dir = await mkdtemp(join(tmpdir(), "story-voice-"));
  try {
    const speech = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: job.voice,
      input: job.text,
      response_format: "mp3",
      instructions: [
        job.speakerName
          ? `You are ${job.speakerName}, a character in a story. Speak this line naturally, with real emotion.`
          : "You are narrating a gripping short story video. Warm, expressive, confident; natural pacing with brief dramatic pauses.",
        voiceTweaks(job.prefs),
      ]
        .filter(Boolean)
        .join(" "),
    });
    const path = join(dir, "voice.mp3");
    const buf = Buffer.from(await speech.arrayBuffer());
    await writeFile(path, buf);
    const audioSec = await audioDuration(path);
    let cost = (audioSec / 60) * PRICE.ttsPerMinute;
    recordUsage(convex, job.userId, {
      provider: "openai",
      model: TTS_MODEL,
      feature: "story.tts",
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: audioSec,
      costUsd: (audioSec / 60) * PRICE.ttsPerMinute,
    });

    let whisper = null;
    if (process.env.GROQ_API_KEY) {
      try {
        const groq = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" });
        const res = await groq.audio.transcriptions.create({
          file: createReadStream(path),
          model: "whisper-large-v3-turbo",
          response_format: "verbose_json",
          timestamp_granularities: ["word"],
        });
        whisper = res.words ?? null;
        const groqCost = (Math.max(10, audioSec) / 3600) * PRICE.groqWhisperPerHour;
        cost += groqCost;
        recordUsage(convex, job.userId, {
          provider: "groq",
          model: "whisper-large-v3-turbo",
          feature: "story.captions",
          inputTokens: 0,
          outputTokens: 0,
          audioSeconds: audioSec,
          costUsd: groqCost,
        });
      } catch (e) {
        console.warn(`[story] ${job.shotId}: caption timing fallback (${e instanceof Error ? e.message : e})`);
      }
    }
    const words = alignWords(job.text, audioSec, whisper);
    const key = await upload(convex, secret, job, "audio", "mp3", buf, "audio/mpeg");
    await convex.mutation(api.storyWorker.saveVoice, {
      secret,
      jobId: job.jobId,
      key,
      audioSec: Math.round(audioSec * 1000) / 1000,
      words: words.map((w) => ({ w: w.w, s: Math.round(w.s * 1000) / 1000, e: Math.round(w.e * 1000) / 1000 })),
      costUsd: round4(cost),
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── render ──

async function runRender({ convex, secret, serveUrl, job }) {
  const dir = await mkdtemp(join(tmpdir(), "story-render-"));
  try {
    if (job.shots.some((s) => !s.imageUrl)) throw new Error("A shot is missing its picture");
    const inputProps = {
      shots: job.shots.map((s) => ({ ...s, camera: CAMERAS.includes(s.camera) ? s.camera : "push_in" })),
      aspect: job.aspect,
      captionStyle: job.captionStyle,
      hook: job.hook || null,
      musicUrl: job.musicUrl ?? null,
      musicVolume: job.musicVolume ?? 0.12,
    };
    const puppeteerInstance = await getBrowser();
    const composition = await selectComposition({ serveUrl, id: "Story", inputProps, puppeteerInstance });
    console.log(`[story] ${job.storyId}: rendering ${composition.width}x${composition.height}, ${composition.durationInFrames} frames`);
    const outPath = join(dir, "story.mp4");
    let last = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      x264Preset: "veryfast",
      outputLocation: outPath,
      inputProps,
      puppeteerInstance,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 95);
        if (pct - last >= 5) {
          last = pct;
          convex.mutation(api.storyWorker.renderProgress, { secret, jobId: job.jobId, progress: pct }).catch(() => {});
        }
      },
    });
    const key = await upload(convex, secret, job, "renders", "mp4", await readFile(outPath), "video/mp4");
    await convex.mutation(api.storyWorker.saveRender, { secret, jobId: job.jobId, key });
  } catch (e) {
    await resetBrowser();
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── video (Phase 2: Higgsfield image-to-video from the shot's still) ──

const HF = "https://api.higgsfield.ai";

function hfHeaders(extra = {}) {
  const key = process.env.HIGGSFIELD_API_KEY?.trim();
  if (!key) throw new Error("HIGGSFIELD_API_KEY is not set for the worker");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json", ...extra };
}

const MOTION_RULES = {
  "Too static": "Make the movement clearly visible.",
  "Weird movement": "Keep the movement simple and physically natural.",
  Glitchy: "Keep the movement simple and smooth.",
  "Character changed": "Keep every character's face, hair, clothing and colours exactly as in the image.",
  "Wrong action": "Follow the described action closely.",
};

function motionText(job, prompt) {
  const rules = tally(job.prefs?.motion, -1)
    .filter(([r]) => MOTION_RULES[r])
    .slice(0, 3)
    .map(([r]) => MOTION_RULES[r]);
  return [
    prompt,
    "Keep the characters, their looks and the setting exactly as in the image. Smooth, natural motion. No text, no new people, no scene cuts.",
    ...rules,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
}

function videoBody(job, prompt) {
  const base = { image_url: job.imageUrl, prompt: motionText(job, prompt), duration: job.duration };
  if (job.model === "kling-3-std") return { ...base, sound: "off" };
  if (job.model === "wan-2.6") return { ...base, resolution: "720p" };
  return { ...base, resolution: "720p", generate_audio: false };
}

// Higgsfield /estimate: {"usd": "0.36"} or a rate card text with "$x per video second".
async function estimateVideo(job, body) {
  const r = await fetch(`${HF}/estimate/${job.endpoint}`, { method: "POST", headers: hfHeaders(), body: JSON.stringify(body) }).catch(() => null);
  const fallback = (STORY_VIDEO_PER_SEC[job.model] ?? 0.08) * job.duration;
  if (!r?.ok) return fallback;
  const data = await r.json().catch(() => ({}));
  const usd = Number(data.usd);
  if (Number.isFinite(usd) && usd > 0) return usd;
  const rate = String(data.pricing_description ?? "").match(/720p:\s*\$(\d+(?:\.\d+)?)/i)?.[1];
  return rate && /per video second/i.test(data.pricing_description) ? Number(rate) * job.duration : fallback;
}
const STORY_VIDEO_PER_SEC = { "kling-3-std": 0.0714, "wan-2.6": 0.075, "seedance-2.0": 0.1735, "kling-avatar": 0.0562 };

// Submit, then wait for Higgsfield to finish. Returns { url } or { refused | error }.
async function generateVideo(job, prompt) {
  const body = videoBody(job, prompt);
  const res = await fetch(`${HF}/${job.endpoint}`, {
    method: "POST",
    headers: hfHeaders({ "Idempotency-Key": `${job.jobId}-${prompt.length}-${Date.now()}` }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${(await res.text()).replace(/<[^>]+>/g, " ").slice(0, 200)}`);
  const sub = await res.json();
  const statusUrl = sub.status_url ?? `${HF}/requests/${sub.request_id}/status`;
  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await fetch(statusUrl, { headers: hfHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!st) continue; // transient; keep polling
    if (st.status === "completed" && st.video?.url) return { url: st.video.url, body };
    if (st.status === "nsfw") return { refused: true };
    if (st.status === "failed" || st.status === "canceled") return { error: st.error || `Generation ${st.status}` };
  }
  return { error: "Higgsfield took longer than 20 minutes" };
}

async function safeMotionRewrite(convex, job) {
  const { data, costUsd } = await geminiJson(convex, job, "story.plan", [
    {
      text: `A video model's safety filter refused this motion description for an illustrated story shot:
"${job.motionPrompt}"
Picture: "${job.imagePrompt}"
Story line: "${job.narration}"
Rewrite the motion so it shows the same moment in a way no safety filter could misread: simple, calm, natural movement in an open, public, well-lit setting; no child being led, taken or followed anywhere secluded; no violence, injury or physical contact beyond a friendly gesture. One sentence plus the camera move.
Return JSON {"motion": "..."}`,
    },
  ]);
  const text = String(data.motion ?? "").trim().slice(0, 800);
  if (!text) throw new Error("The video model refused this shot. Edit the motion description and redo it.");
  return { text, costUsd };
}

// ── talking shots (fal.ai Kling AI Avatar: still + voice → lip-synced clip) ──

const FAL_QUEUE = "https://queue.fal.run";

function falHeaders() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not set for the worker");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

const falError = (data, status) => {
  const d = data?.detail;
  const msg = Array.isArray(d) ? d.map((x) => x?.msg ?? JSON.stringify(x)).join("; ") : typeof d === "string" ? d : data?.error;
  return String(msg || `fal ${status}`).slice(0, 300);
};

// Submit, wait, fetch the result. Returns { url, sec } or { refused | error }.
async function generateTalking(job, prompt) {
  const body = {
    image_url: job.imageUrl,
    audio_url: job.audioUrl,
    prompt: `${prompt ? `${prompt.slice(0, 600)} ` : ""}The character speaks the line naturally, with natural facial expressions and small head movements. Keep their look exactly as in the image.`,
  };
  const res = await fetch(`${FAL_QUEUE}/${job.endpoint}`, { method: "POST", headers: falHeaders(), body: JSON.stringify(body) });
  const sub = await res.json().catch(() => ({}));
  if (!res.ok) return { error: falError(sub, res.status) };
  const statusUrl = sub.status_url ?? `${FAL_QUEUE}/${job.endpoint}/requests/${sub.request_id}/status`;
  const responseUrl = sub.response_url ?? `${FAL_QUEUE}/${job.endpoint}/requests/${sub.request_id}`;
  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 8_000));
    const st = await fetch(statusUrl, { headers: falHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!st || st.status !== "COMPLETED") continue; // IN_QUEUE / IN_PROGRESS / transient
    const out = await fetch(responseUrl, { headers: falHeaders() });
    const data = await out.json().catch(() => ({}));
    if (!out.ok || !data.video?.url) {
      const msg = falError(data, out.status);
      return /safety|nsfw|content|policy|moderat/i.test(msg) ? { refused: true, error: msg } : { error: msg };
    }
    return { url: data.video.url, sec: Number(data.duration) || null };
  }
  return { error: "fal.ai took longer than 20 minutes" };
}

async function runVideo({ convex, secret, job }) {
  if (job.talking) return runTalking({ convex, secret, job });
  let cost = 0;
  let prompt = job.motionPrompt;
  let rewritten = null;
  let result = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const est = await estimateVideo(job, videoBody(job, prompt));
    result = await generateVideo(job, prompt);
    if (result.url) {
      cost += est; // failed / refused generations aren't charged by Higgsfield
      break;
    }
    if (result.refused && attempt === 0) {
      const safe = await safeMotionRewrite(convex, job);
      cost += safe.costUsd;
      prompt = safe.text;
      rewritten = safe.text;
      console.warn(`[story] video ${job.shotId}: refused by the content filter; retrying with a safer motion line`);
      continue;
    }
    throw new Error(
      result.refused
        ? "The video model's content filter refused this shot, even after a safer rewrite. Edit the motion description and redo it."
        : `Animating this shot failed: ${result.error}`
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "story-video-"));
  try {
    const r = await fetch(result.url);
    if (!r.ok) throw new Error(`Could not download the generated video (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    const path = join(dir, "clip.mp4");
    await writeFile(path, buf);
    const videoSec = await audioDuration(path).catch(() => job.duration);
    const key = await upload(convex, secret, job, "videos", "mp4", buf, "video/mp4");
    recordUsage(convex, job.userId, {
      provider: "higgsfield",
      model: job.model,
      feature: "story.video",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: cost,
    });
    await convex.mutation(api.storyWorker.saveVideo, {
      secret,
      jobId: job.jobId,
      key,
      videoSec: Math.round(videoSec * 100) / 100,
      costUsd: round4(cost),
      ...(rewritten ? { motionPrompt: rewritten } : {}),
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runTalking({ convex, secret, job }) {
  if (!job.audioUrl) throw new Error("This shot needs its voice before it can talk.");
  let cost = 0;
  let prompt = job.motionPrompt;
  let rewritten = null;
  let result = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    result = await generateTalking(job, prompt);
    if (result.url) break; // fal only bills finished videos
    if (result.refused && attempt === 0) {
      const safe = await safeMotionRewrite(convex, job);
      cost += safe.costUsd;
      prompt = safe.text;
      rewritten = safe.text;
      console.warn(`[story] talking ${job.shotId}: refused by the content filter; retrying with a safer prompt`);
      continue;
    }
    throw new Error(
      result.refused
        ? "The talking-video model's safety filter refused this shot. Try redrawing the picture, then make it talk again."
        : `Making this shot talk failed: ${result.error}`
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "story-talk-"));
  try {
    const r = await fetch(result.url);
    if (!r.ok) throw new Error(`Could not download the talking video (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    const path = join(dir, "talk.mp4");
    await writeFile(path, buf);
    const videoSec = await audioDuration(path).catch(() => result.sec ?? job.duration);
    const talkCost = (result.sec ?? videoSec) * (STORY_VIDEO_PER_SEC[job.model] ?? 0.0562);
    cost += talkCost;
    const key = await upload(convex, secret, job, "videos", "mp4", buf, "video/mp4");
    recordUsage(convex, job.userId, {
      provider: "fal",
      model: job.model,
      feature: "story.talk",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: talkCost,
    });
    await convex.mutation(api.storyWorker.saveVideo, {
      secret,
      jobId: job.jobId,
      key,
      videoSec: Math.round(videoSec * 100) / 100,
      costUsd: round4(cost),
      ...(rewritten ? { motionPrompt: rewritten } : {}),
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const RUNNERS = { script: runScript, plan: runPlan, ref: runRef, still: runStill, voice: runVoice, video: runVideo, render: runRender };

export async function runStoryJob({ convex, secret, serveUrl, job }) {
  const run = RUNNERS[job.kind];
  if (!run) throw new Error(`Unknown story job kind: ${job.kind}`);
  await run({ convex, secret, serveUrl, job });
}
