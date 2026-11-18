import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { r2, SIX_HOURS, storagePrefix } from "./r2";
import { assertWorker } from "./broll";
import { shotsOf } from "./stories";
import { recentFeedback } from "./storyFeedback";
import type { FeedbackStage, StoryBible, StoryVideoModel } from "../types/story";
import {
  DEFAULT_MUSIC_VOLUME,
  MUSIC_KEY,
  MUSIC_MOODS,
  STORY_MUSIC,
  STORY_STYLES,
  STORY_VIDEO_MODELS,
  VOICE_IDS,
  isTalking,
  shotSeconds,
  videoDurationFor,
} from "../types/story";

// Story Studio, worker-facing (shared secret). render-worker/story.mjs claims
// jobs by kind, does the AI work, uploads files to R2 and saves results here.

const STALE_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CAMERAS = ["push_in", "pull_out", "pan_left", "pan_right", "static"];
const kindV = v.union(v.literal("script"), v.literal("plan"), v.literal("ref"), v.literal("still"), v.literal("voice"), v.literal("video"), v.literal("render"));

const signed = (key: string | null | undefined) => (key ? r2.getUrl(key, { expiresIn: SIX_HOURS }) : Promise.resolve(null));

function styleText(story: Doc<"stories">) {
  const base = STORY_STYLES[story.style]?.prompt ?? STORY_STYLES.cinematic.prompt;
  return story.styleNotes ? `${base}; ${story.styleNotes}` : base;
}

async function addCost(ctx: MutationCtx, storyId: Id<"stories">, usd: number | undefined) {
  if (!usd) return;
  const story = await ctx.db.get(storyId);
  if (story) await ctx.db.patch(storyId, { costUsd: Math.round((story.costUsd + usd) * 10000) / 10000 });
}

async function finish(ctx: MutationCtx, jobId: Id<"storyJobs">) {
  const job = await ctx.db.get(jobId);
  if (job) await ctx.db.patch(jobId, { status: "done" });
  return job;
}

// The creator's recent feedback (all stories) for the AI prompts; see prefsBlock
// in render-worker/story.mjs.
async function prefsFor(ctx: MutationCtx, userId: string, stages: FeedbackStage[]) {
  const out: Record<string, { rating: number; reasons: string[]; note: string | null; snapshot: string | null; implicit: boolean }[]> = {};
  for (const stage of stages) {
    out[stage] = (await recentFeedback(ctx, userId, stage, 40)).map((r) => ({
      rating: r.rating,
      reasons: r.reasons,
      note: r.note ?? null,
      snapshot: r.snapshot ?? null,
      implicit: r.implicit,
    }));
  }
  return out;
}

// Existing cast (series episodes, or a re-plan) for the Writer and Director.
function castOf(bible: StoryBible | null) {
  if (!bible) return null;
  return {
    characters: bible.characters.map((c) => ({ id: c.id, name: c.name, look: c.look, voice: c.voice })),
    locations: bible.locations.map((l) => ({ id: l.id, name: l.name, look: l.look })),
  };
}

// Build what the worker needs for one job. Returns null when the target is gone.
async function payload(ctx: MutationCtx, job: Doc<"storyJobs">, story: Doc<"stories">) {
  const base = {
    jobId: job._id,
    kind: job.kind,
    storyId: story._id,
    userId: story.userId,
    aspect: story.aspect,
    style: styleText(story),
  };
  const bible = (story.bible ?? null) as StoryBible | null;

  if (job.kind === "script") {
    return {
      ...base,
      idea: story.idea,
      targetSec: story.targetSec,
      script: story.script ?? null,
      notes: job.input ?? null,
      cast: castOf(bible),
      prefs: await prefsFor(ctx, story.userId, ["script", "video"]),
    };
  }
  if (job.kind === "plan") {
    return {
      ...base,
      script: story.script ?? "",
      targetSec: story.targetSec,
      voices: VOICE_IDS,
      narratorVoice: story.narratorVoice,
      cast: castOf(bible),
      prefs: await prefsFor(ctx, story.userId, ["plan", "video"]),
    };
  }
  if (job.kind === "ref") {
    const [kind, id] = (job.targetId ?? "").split(":");
    const item = kind === "character" ? bible?.characters.find((c) => c.id === id) : bible?.locations.find((l) => l.id === id);
    if (!item) return null;
    return { ...base, refKind: kind, item: { id: item.id, name: item.name, look: item.look } };
  }
  if (job.kind === "video") {
    const shot = await ctx.db.get(job.targetId as Id<"storyShots">);
    if (!shot || shot.storyId !== story._id || !shot.stillKey) return null;
    const model = (shot.videoModel ?? story.videoModel ?? "kling-3-std") as StoryVideoModel;
    const m = STORY_VIDEO_MODELS[model] ?? STORY_VIDEO_MODELS["kling-3-std"];
    return {
      ...base,
      shotId: shot._id,
      model,
      endpoint: m.endpoint,
      provider: m.provider ?? "higgsfield",
      talking: !!m.talking,
      duration: videoDurationFor(model, shotSeconds(shot.audioSec)),
      imageUrl: await signed(shot.stillKey),
      audioUrl: m.talking ? await signed(shot.audioKey) : null,
      motionPrompt: shot.motionPrompt || shot.imagePrompt,
      imagePrompt: shot.imagePrompt,
      narration: shot.narration,
      camera: shot.camera,
      characters: (bible?.characters ?? [])
        .filter((c) => shot.characters.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name, look: c.look })),
      prefs: await prefsFor(ctx, story.userId, ["motion"]),
    };
  }
  if (job.kind === "still" || job.kind === "voice") {
    const shot = await ctx.db.get(job.targetId as Id<"storyShots">);
    if (!shot || shot.storyId !== story._id) return null;
    if (job.kind === "voice") {
      const speaker = bible?.characters.find((c) => c.id === shot.speaker);
      return {
        ...base,
        shotId: shot._id,
        text: shot.narration,
        voice: speaker?.voice ?? story.narratorVoice,
        speakerName: speaker?.name ?? null,
        prefs: await prefsFor(ctx, story.userId, ["voice"]),
      };
    }
    const chars = await Promise.all(
      (bible?.characters ?? [])
        .filter((c) => shot.characters.includes(c.id))
        .map(async (c) => ({ id: c.id, name: c.name, look: c.look, refUrl: await signed(c.refKey) }))
    );
    const loc = bible?.locations.find((l) => l.id === shot.location);
    return {
      ...base,
      shotId: shot._id,
      imagePrompt: shot.imagePrompt,
      camera: shot.camera,
      narration: shot.narration,
      characters: chars,
      location: loc ? { id: loc.id, name: loc.name, look: loc.look, refUrl: await signed(loc.refKey) } : null,
      prefs: await prefsFor(ctx, story.userId, ["still"]),
    };
  }
  // render
  const shots = await shotsOf(ctx, story._id);
  return {
    ...base,
    title: story.title,
    captionStyle: story.captionStyle ?? "bold",
    hook: story.hook ?? null,
    shots: await Promise.all(
      shots.map(async (s) => ({
        imageUrl: await signed(s.stillKey),
        videoUrl: s.mode === "video" && s.videoStatus === "ready" ? await signed(s.videoKey) : null,
        videoSec: s.videoSec ?? null,
        lipSync: s.mode === "video" && s.videoStatus === "ready" && isTalking(s.videoModel),
        audioUrl: await signed(s.audioKey),
        durationSec: shotSeconds(s.audioSec),
        camera: s.camera,
        words: s.words ?? [],
      }))
    ),
    musicUrl: story.musicTrack ? await signed(MUSIC_KEY(story.musicTrack)) : null,
    musicVolume: story.musicVolume ?? DEFAULT_MUSIC_VOLUME,
  };
}

async function markTarget(ctx: MutationCtx, job: Doc<"storyJobs">, status: string, error: string | null = null) {
  if (job.kind === "still") {
    await ctx.db.patch(job.targetId as Id<"storyShots">, { stillStatus: status, stillError: error });
  } else if (job.kind === "voice") {
    await ctx.db.patch(job.targetId as Id<"storyShots">, { audioStatus: status, audioError: error });
  } else if (job.kind === "video") {
    await ctx.db.patch(job.targetId as Id<"storyShots">, { videoStatus: status, videoError: error });
  } else if (job.kind === "ref") {
    const story = await ctx.db.get(job.storyId);
    const bible = story?.bible as StoryBible | undefined;
    const [kind, id] = (job.targetId ?? "").split(":");
    const item = kind === "character" ? bible?.characters.find((c) => c.id === id) : bible?.locations.find((l) => l.id === id);
    if (item && story) {
      item.refStatus = status as typeof item.refStatus;
      item.refError = error;
      await ctx.db.patch(story._id, { bible });
    }
  } else if (job.kind === "render") {
    await ctx.db.patch(job.storyId, {
      renderStatus: status === "working" ? "rendering" : status === "failed" ? "failed" : "queued",
      renderError: error,
    });
  } else if (status === "failed") {
    await ctx.db.patch(job.storyId, { error: `${job.kind === "script" ? "Writing the script" : "Planning the shots"} failed: ${error}` });
  }
}

export const claimJob = mutation({
  args: { secret: v.string(), kinds: v.array(kindV) },
  handler: async (ctx, { secret, kinds }) => {
    assertWorker(secret);
    const now = Date.now();
    const queued = await ctx.db.query("storyJobs").withIndex("by_status", (q) => q.eq("status", "queued")).take(200);
    let job = queued.find((j) => kinds.includes(j.kind));
    if (!job) {
      const working = await ctx.db.query("storyJobs").withIndex("by_status", (q) => q.eq("status", "working")).take(200);
      job = working.find((j) => kinds.includes(j.kind) && (j.startedAt ?? 0) < now - STALE_MS);
    }
    if (!job) return null;
    const story = await ctx.db.get(job.storyId);
    const data = story ? await payload(ctx, job, story) : null;
    if (!data) {
      await ctx.db.patch(job._id, { status: "failed", error: "Target was deleted" });
      return { skip: true as const };
    }
    if (job.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(job._id, { status: "failed", error: "Too many attempts" });
      await markTarget(ctx, job, "failed", "Gave up after several attempts");
      return { skip: true as const };
    }
    await ctx.db.patch(job._id, { status: "working", startedAt: now, attempts: job.attempts + 1 });
    await markTarget(ctx, job, "working");
    return data;
  },
});

export const releaseJob = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs") },
  handler: async (ctx, { secret, jobId }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "working") return null;
    await ctx.db.patch(jobId, { status: "queued", attempts: Math.max(0, job.attempts - 1) });
    await markTarget(ctx, job, "queued");
    return null;
  },
});

export const failJob = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs"), error: v.string() },
  handler: async (ctx, { secret, jobId, error }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    await ctx.db.patch(jobId, { status: "failed", error: error.slice(0, 500) });
    await markTarget(ctx, job, "failed", error.slice(0, 300));
    return null;
  },
});

export const uploadUrl = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs"), folder: v.string(), ext: v.string() },
  handler: async (ctx, { secret, jobId, folder, ext }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (!["refs", "stills", "audio", "videos", "renders"].includes(folder)) throw new Error("Bad folder");
    const key = `${storagePrefix()}/stories/${job.userId}/${job.storyId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext.replace(/[^a-z0-9]/g, "")}`;
    const { url } = await r2.generateUploadUrl(key);
    return { url, key };
  },
});

// ── Results ──

export const saveScript = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs"), title: v.string(), hook: v.string(), script: v.string(), costUsd: v.number() },
  handler: async (ctx, { secret, jobId, title, hook, script, costUsd }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    if (!job || !(await ctx.db.get(job.storyId))) return null;
    await ctx.db.patch(job.storyId, {
      title: title.slice(0, 120),
      hook: hook.slice(0, 200),
      script: script.slice(0, 20_000),
      error: null,
      updatedAt: Date.now(),
    });
    await addCost(ctx, job.storyId, costUsd);
    return null;
  },
});

const shotV = v.object({
  narration: v.string(),
  speaker: v.string(),
  characters: v.array(v.string()),
  location: v.union(v.string(), v.null()),
  camera: v.string(),
  imagePrompt: v.string(),
  motionPrompt: v.string(),
});

export const savePlan = mutation({
  args: {
    secret: v.string(),
    jobId: v.id("storyJobs"),
    characters: v.array(v.object({ id: v.string(), name: v.string(), look: v.string(), voice: v.string() })),
    locations: v.array(v.object({ id: v.string(), name: v.string(), look: v.string() })),
    shots: v.array(shotV),
    musicMood: v.optional(v.string()),
    costUsd: v.number(),
  },
  handler: async (ctx, { secret, jobId, characters, locations, shots, musicMood, costUsd }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    const story = job ? await ctx.db.get(job.storyId) : null;
    if (!job || !story) return null;

    // A re-plan replaces the shots. Reference images are kept for characters
    // and locations that are unchanged (same id and look) or come from a
    // series; the rest are deleted (series files are shared, never deleted).
    const old = story.bible as StoryBible | undefined;
    const oldById = new Map([...(old?.characters ?? []), ...(old?.locations ?? [])].map((x) => [x.id, x]));
    const keep = (id: string, look: string) => {
      const o = oldById.get(id);
      if (!o?.refKey || o.refStatus !== "ready") return null;
      return o.refKey.includes("/series/") || o.look === look ? o : null;
    };
    const kept = new Set<string>();
    const reuse = <T extends { id: string; look: string }>(x: T) => {
      const o = keep(x.id, x.look);
      if (o) kept.add(o.refKey!);
      return o ? { ...x, look: o.look, refKey: o.refKey, refStatus: "ready" as const } : { ...x, refStatus: "none" as const, refKey: null };
    };
    const bible: StoryBible = {
      characters: characters.map((c) => {
        const r = reuse(c);
        const o = oldById.get(c.id) as { voice?: string } | undefined;
        return r.refStatus === "ready" && o?.voice ? { ...r, voice: o.voice } : r;
      }),
      locations: locations.map((l) => reuse(l)),
    };
    // Series characters missing from the new plan stay in the bible too.
    for (const o of old?.characters ?? []) {
      if (o.refKey?.includes("/series/") && !bible.characters.some((c) => c.id === o.id)) bible.characters.push(o);
    }
    for (const o of old?.locations ?? []) {
      if (o.refKey?.includes("/series/") && !bible.locations.some((l) => l.id === o.id)) bible.locations.push(o);
    }
    for (const x of [...(old?.characters ?? []), ...(old?.locations ?? [])]) {
      if (x.refKey && !kept.has(x.refKey) && !x.refKey.includes("/series/")) await r2.deleteObject(ctx, x.refKey).catch(() => {});
    }
    for (const s of await shotsOf(ctx, story._id)) {
      for (const k of [s.stillKey, s.audioKey, s.videoKey]) if (k) await r2.deleteObject(ctx, k).catch(() => {});
      await ctx.db.delete(s._id);
    }

    const charIds = new Set(bible.characters.map((c) => c.id));
    const locIds = new Set(bible.locations.map((l) => l.id));
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      await ctx.db.insert("storyShots", {
        storyId: story._id,
        userId: story.userId,
        order: i,
        narration: s.narration.slice(0, 600),
        speaker: charIds.has(s.speaker) ? s.speaker : "narrator",
        characters: s.characters.filter((c) => charIds.has(c)).slice(0, 4),
        location: s.location && locIds.has(s.location) ? s.location : null,
        camera: CAMERAS.includes(s.camera) ? s.camera : "push_in",
        imagePrompt: s.imagePrompt.slice(0, 1500),
        motionPrompt: s.motionPrompt.slice(0, 800),
        mode: "still",
        stillStatus: "none",
        audioStatus: "none",
      });
    }
    // Background music: a track in the Director's mood (stable pick per story).
    const mood = MUSIC_MOODS.includes(musicMood as (typeof MUSIC_MOODS)[number]) ? musicMood : null;
    const tracks = STORY_MUSIC.filter((m) => m.mood === mood);
    const musicTrack =
      story.musicTrack !== undefined ? story.musicTrack : tracks.length ? tracks[Math.floor(story._creationTime) % tracks.length].id : null;
    await ctx.db.patch(story._id, {
      bible,
      step: "plan",
      error: null,
      outputKey: undefined,
      renderStatus: undefined,
      musicTrack,
      updatedAt: Date.now(),
    });
    await addCost(ctx, story._id, costUsd);
    return null;
  },
});

export const saveRef = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs"), key: v.string(), costUsd: v.number() },
  handler: async (ctx, { secret, jobId, key, costUsd }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    const story = job ? await ctx.db.get(job.storyId) : null;
    if (!job || !story) return null;
    const bible = story.bible as StoryBible;
    const [kind, id] = (job.targetId ?? "").split(":");
    const item = kind === "character" ? bible.characters.find((c) => c.id === id) : bible.locations.find((l) => l.id === id);
    if (!item) {
      await r2.deleteObject(ctx, key).catch(() => {});
      return null;
    }
    if (item.refKey && item.refKey !== key) await r2.deleteObject(ctx, item.refKey).catch(() => {});
    item.refKey = key;
    item.refStatus = "ready";
    item.refError = null;
    await ctx.db.patch(story._id, { bible, updatedAt: Date.now() });
    await addCost(ctx, story._id, costUsd);
    return null;
  },
});

export const saveStill = mutation({
  args: {
    secret: v.string(),
    jobId: v.id("storyJobs"),
    key: v.string(),
    continuity: v.union(v.object({ ok: v.boolean(), issue: v.optional(v.string()) }), v.null()),
    costUsd: v.number(),
    // Set when the worker had to rewrite a refused description to draw it.
    imagePrompt: v.optional(v.string()),
  },
  handler: async (ctx, { secret, jobId, key, continuity, costUsd, imagePrompt }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    const shot = job ? await ctx.db.get(job.targetId as Id<"storyShots">) : null;
    if (!job || !shot) {
      await r2.deleteObject(ctx, key).catch(() => {});
      return null;
    }
    if (shot.stillKey && shot.stillKey !== key) await r2.deleteObject(ctx, shot.stillKey).catch(() => {});
    await ctx.db.patch(shot._id, {
      stillKey: key,
      stillStatus: "ready",
      stillError: null,
      continuity,
      ...(imagePrompt ? { imagePrompt: imagePrompt.slice(0, 1500) } : {}),
    });
    await addCost(ctx, job.storyId, costUsd);
    return null;
  },
});

export const saveVoice = mutation({
  args: {
    secret: v.string(),
    jobId: v.id("storyJobs"),
    key: v.string(),
    audioSec: v.number(),
    words: v.array(v.object({ w: v.string(), s: v.number(), e: v.number() })),
    costUsd: v.number(),
  },
  handler: async (ctx, { secret, jobId, key, audioSec, words, costUsd }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    const shot = job ? await ctx.db.get(job.targetId as Id<"storyShots">) : null;
    if (!job || !shot) {
      await r2.deleteObject(ctx, key).catch(() => {});
      return null;
    }
    if (shot.audioKey && shot.audioKey !== key) await r2.deleteObject(ctx, shot.audioKey).catch(() => {});
    await ctx.db.patch(shot._id, { audioKey: key, audioSec, words, audioStatus: "ready", audioError: null });
    await addCost(ctx, job.storyId, costUsd);
    return null;
  },
});

export const renderProgress = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs"), progress: v.number() },
  handler: async (ctx, { secret, jobId, progress }) => {
    assertWorker(secret);
    const job = await ctx.db.get(jobId);
    if (job) await ctx.db.patch(job.storyId, { renderProgress: Math.max(0, Math.min(99, Math.round(progress))) });
    return null;
  },
});

export const saveRender = mutation({
  args: { secret: v.string(), jobId: v.id("storyJobs"), key: v.string() },
  handler: async (ctx, { secret, jobId, key }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    const story = job ? await ctx.db.get(job.storyId) : null;
    if (!job || !story) {
      await r2.deleteObject(ctx, key).catch(() => {});
      return null;
    }
    if (story.outputKey && story.outputKey !== key) await r2.deleteObject(ctx, story.outputKey).catch(() => {});
    await ctx.db.patch(story._id, { outputKey: key, renderStatus: "done", renderProgress: 100, renderError: null, updatedAt: Date.now() });
    return null;
  },
});

export const saveVideo = mutation({
  args: {
    secret: v.string(),
    jobId: v.id("storyJobs"),
    key: v.string(),
    videoSec: v.number(),
    costUsd: v.number(),
    motionPrompt: v.optional(v.string()), // set when the worker had to rewrite a refused motion line
  },
  handler: async (ctx, { secret, jobId, key, videoSec, costUsd, motionPrompt }) => {
    assertWorker(secret);
    const job = await finish(ctx, jobId);
    const shot = job ? await ctx.db.get(job.targetId as Id<"storyShots">) : null;
    if (!job || !shot) {
      await r2.deleteObject(ctx, key).catch(() => {});
      return null;
    }
    if (shot.videoKey && shot.videoKey !== key) await r2.deleteObject(ctx, shot.videoKey).catch(() => {});
    await ctx.db.patch(shot._id, {
      videoKey: key,
      videoStatus: "ready",
      videoError: null,
      videoSec,
      videoCostUsd: costUsd,
      mode: "video",
      ...(motionPrompt ? { motionPrompt: motionPrompt.slice(0, 800) } : {}),
    });
    await addCost(ctx, job.storyId, costUsd);
    return null;
  },
});

