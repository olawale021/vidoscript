import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { downloadUrl, r2, safeFileName, SIX_HOURS } from "./r2";
import type { StoryBible, StoryJobKind } from "../types/story";
import { MUSIC_KEY, STORY_MUSIC, STORY_STYLES, VIDEO_MODEL_IDS, VOICE_IDS, isTalking, type StoryVideoModel } from "../types/story";
import { recordImplicit } from "./storyFeedback";

// Story Studio, user-facing. The worker side is convex/storyWorker.ts and
// render-worker/story.mjs. Every slow step is a row in storyJobs.

const CAMERAS = ["push_in", "pull_out", "pan_left", "pan_right", "static"];

async function requireUser(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

async function ownStory(ctx: QueryCtx, storyId: Id<"stories">) {
  const userId = await requireUser(ctx);
  const story = await ctx.db.get(storyId);
  if (!story || story.userId !== userId) throw new Error("Not found");
  return story;
}

async function ownShot(ctx: QueryCtx, shotId: Id<"storyShots">) {
  const userId = await requireUser(ctx);
  const shot = await ctx.db.get(shotId);
  if (!shot || shot.userId !== userId) throw new Error("Not found");
  return shot;
}

export async function shotsOf(ctx: QueryCtx, storyId: Id<"stories">) {
  return await ctx.db
    .query("storyShots")
    .withIndex("by_story", (q) => q.eq("storyId", storyId))
    .collect();
}

// Queue a job unless the same one is already waiting or running.
export async function enqueue(
  ctx: MutationCtx,
  story: Doc<"stories">,
  kind: StoryJobKind,
  targetId?: string,
  input?: string
) {
  const open = await ctx.db
    .query("storyJobs")
    .withIndex("by_story", (q) => q.eq("storyId", story._id).eq("status", "queued"))
    .collect();
  if (open.some((j) => j.kind === kind && j.targetId === targetId)) return;
  await ctx.db.insert("storyJobs", {
    storyId: story._id,
    userId: story.userId,
    kind,
    targetId,
    input,
    status: "queued",
    attempts: 0,
    createdAt: Date.now(),
  });
}

const touch = (ctx: MutationCtx, id: Id<"stories">, patch: Partial<Doc<"stories">> = {}) =>
  ctx.db.patch(id, { ...patch, updatedAt: Date.now() });

const signed = (key: string | null | undefined) => (key ? r2.getUrl(key, { expiresIn: SIX_HOURS }) : null);

// ── Queries ──

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const stories = await ctx.db
      .query("stories")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(100);
    return await Promise.all(
      stories.map(async (s) => {
        const first = await ctx.db
          .query("storyShots")
          .withIndex("by_story", (q) => q.eq("storyId", s._id))
          .first();
        return {
          _id: s._id,
          title: s.title,
          step: s.step,
          aspect: s.aspect,
          targetSec: s.targetSec,
          renderStatus: s.renderStatus ?? null,
          costUsd: s.costUsd,
          createdAt: s.createdAt,
          thumbUrl: await signed(first?.stillKey),
        };
      })
    );
  },
});

export const get = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const story = await ctx.db.get(storyId);
    if (!story || story.userId !== identity.subject) return null;

    const bible = (story.bible ?? null) as StoryBible | null;
    const refUrls: Record<string, string | null> = {};
    if (bible) {
      for (const c of bible.characters) refUrls[`character:${c.id}`] = await signed(c.refKey);
      for (const l of bible.locations) refUrls[`location:${l.id}`] = await signed(l.refKey);
    }
    const shots = await Promise.all(
      (await shotsOf(ctx, storyId)).map(async (s) => ({
        ...s,
        stillUrl: await signed(s.stillKey),
        videoUrl: await signed(s.videoKey),
        audioUrl: await signed(s.audioKey),
      }))
    );
    const jobs = [
      ...(await ctx.db.query("storyJobs").withIndex("by_story", (q) => q.eq("storyId", storyId).eq("status", "queued")).collect()),
      ...(await ctx.db.query("storyJobs").withIndex("by_story", (q) => q.eq("storyId", storyId).eq("status", "working")).collect()),
    ];
    return {
      ...story,
      bible,
      refUrls,
      shots,
      busy: {
        script: jobs.some((j) => j.kind === "script"),
        plan: jobs.some((j) => j.kind === "plan"),
        refs: jobs.filter((j) => j.kind === "ref").length,
        stills: jobs.filter((j) => j.kind === "still").length,
        voices: jobs.filter((j) => j.kind === "voice").length,
        render: jobs.some((j) => j.kind === "render"),
      },
      downloadUrl: story.outputKey ? await downloadUrl(story.outputKey, safeFileName(story.title)) : null,
      musicUrl: story.musicTrack ? await signed(MUSIC_KEY(story.musicTrack)) : null,
      seriesTitle: story.seriesId ? ((await ctx.db.get(story.seriesId))?.title ?? null) : null,
    };
  },
});

// ── Create + script ──

export const create = mutation({
  args: {
    idea: v.string(),
    aspect: v.union(v.literal("9:16"), v.literal("16:9")),
    targetSec: v.number(),
    style: v.string(),
    styleNotes: v.optional(v.string()),
    narratorVoice: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const idea = args.idea.trim().slice(0, 4000);
    if (idea.length < 5) throw new Error("Describe your story idea in a sentence or two.");
    if (!STORY_STYLES[args.style]) throw new Error("Unknown style");
    if (!VOICE_IDS.includes(args.narratorVoice)) throw new Error("Unknown voice");
    const now = Date.now();
    const id = await ctx.db.insert("stories", {
      userId,
      title: idea.length > 60 ? `${idea.slice(0, 57)}…` : idea,
      idea,
      aspect: args.aspect,
      targetSec: Math.max(15, Math.min(300, Math.round(args.targetSec))),
      style: args.style,
      styleNotes: args.styleNotes?.trim().slice(0, 500) || undefined,
      narratorVoice: args.narratorVoice,
      step: "script",
      captionStyle: "bold",
      costUsd: 0,
      createdAt: now,
      updatedAt: now,
    });
    await enqueue(ctx, (await ctx.db.get(id))!, "script");
    return id;
  },
});

export const updateScript = mutation({
  args: { storyId: v.id("stories"), script: v.string(), title: v.optional(v.string()), hook: v.optional(v.string()) },
  handler: async (ctx, { storyId, script, title, hook }) => {
    await ownStory(ctx, storyId);
    await touch(ctx, storyId, {
      script: script.slice(0, 20_000),
      ...(title?.trim() ? { title: title.trim().slice(0, 120) } : {}),
      ...(hook !== undefined ? { hook: hook.trim().slice(0, 200) } : {}),
    });
    return null;
  },
});

export const rewriteScript = mutation({
  args: { storyId: v.id("stories"), notes: v.optional(v.string()) },
  handler: async (ctx, { storyId, notes }) => {
    const story = await ownStory(ctx, storyId);
    await touch(ctx, storyId, { step: "script", error: null });
    await enqueue(ctx, story, "script", undefined, notes?.trim().slice(0, 1000) || undefined);
    if (notes?.trim() && story.script) {
      await recordImplicit(ctx, {
        userId: story.userId,
        storyId,
        stage: "script",
        rating: 0,
        reasons: ["Asked for a rewrite"],
        note: notes.trim().slice(0, 300),
        snapshot: `Title: ${story.title}\nHook: ${story.hook ?? ""}`,
      });
    }
    return null;
  },
});

export const confirmScript = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ownStory(ctx, storyId);
    if (!story.script?.trim()) throw new Error("Write or generate a script first.");
    await touch(ctx, storyId, { step: "plan", error: null });
    await enqueue(ctx, story, "plan");
    return null;
  },
});

// ── Plan edits ──

export const replan = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ownStory(ctx, storyId);
    await touch(ctx, storyId, { step: "plan", error: null });
    await enqueue(ctx, story, "plan");
    return null;
  },
});

export const updateShot = mutation({
  args: {
    shotId: v.id("storyShots"),
    narration: v.optional(v.string()),
    imagePrompt: v.optional(v.string()),
    camera: v.optional(v.string()),
    speaker: v.optional(v.string()),
    characters: v.optional(v.array(v.string())),
    location: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { shotId, ...patch }) => {
    const shot = await ownShot(ctx, shotId);
    const story = (await ctx.db.get(shot.storyId))!;
    const next: Partial<Doc<"storyShots">> = {};
    if (patch.narration !== undefined) next.narration = patch.narration.trim().slice(0, 600);
    if (patch.imagePrompt !== undefined) next.imagePrompt = patch.imagePrompt.trim().slice(0, 1500);
    if (patch.camera !== undefined && CAMERAS.includes(patch.camera)) next.camera = patch.camera;
    if (patch.speaker !== undefined) next.speaker = patch.speaker;
    if (patch.characters !== undefined) next.characters = patch.characters.slice(0, 4);
    if (patch.location !== undefined) next.location = patch.location;
    await ctx.db.patch(shotId, next);
    // New words or voice → the old audio no longer matches.
    const voiceChanged =
      (next.narration !== undefined && next.narration !== shot.narration) ||
      (next.speaker !== undefined && next.speaker !== shot.speaker);
    if (voiceChanged && (story.step === "board" || story.step === "export")) {
      await ctx.db.patch(shotId, { audioStatus: "queued", audioError: null });
      await enqueue(ctx, story, "voice", shotId);
    }
    await touch(ctx, story._id);
    return null;
  },
});

export const addShot = mutation({
  args: { storyId: v.id("stories"), afterShotId: v.optional(v.id("storyShots")) },
  handler: async (ctx, { storyId, afterShotId }) => {
    const story = await ownStory(ctx, storyId);
    const shots = await shotsOf(ctx, storyId);
    const idx = afterShotId ? shots.findIndex((s) => s._id === afterShotId) : shots.length - 1;
    // Renumber to make room after idx.
    for (let i = shots.length - 1; i > idx; i--) await ctx.db.patch(shots[i]._id, { order: i + 1 });
    const prev = shots[idx];
    const id = await ctx.db.insert("storyShots", {
      storyId,
      userId: story.userId,
      order: idx + 1,
      narration: "",
      speaker: "narrator",
      characters: prev?.characters ?? [],
      location: prev?.location ?? null,
      camera: "push_in",
      imagePrompt: "",
      mode: "still",
      stillStatus: "none",
      audioStatus: "none",
    });
    await touch(ctx, storyId);
    return id;
  },
});

export const deleteShot = mutation({
  args: { shotId: v.id("storyShots") },
  handler: async (ctx, { shotId }) => {
    const shot = await ownShot(ctx, shotId);
    for (const key of [shot.stillKey, shot.audioKey]) if (key) await r2.deleteObject(ctx, key).catch(() => {});
    await ctx.db.delete(shotId);
    const rest = await shotsOf(ctx, shot.storyId);
    for (let i = 0; i < rest.length; i++) if (rest[i].order !== i) await ctx.db.patch(rest[i]._id, { order: i });
    await touch(ctx, shot.storyId);
    return null;
  },
});

export const moveShot = mutation({
  args: { shotId: v.id("storyShots"), dir: v.union(v.literal(-1), v.literal(1)) },
  handler: async (ctx, { shotId, dir }) => {
    const shot = await ownShot(ctx, shotId);
    const shots = await shotsOf(ctx, shot.storyId);
    const i = shots.findIndex((s) => s._id === shotId);
    const j = i + dir;
    if (j < 0 || j >= shots.length) return null;
    await ctx.db.patch(shots[i]._id, { order: j });
    await ctx.db.patch(shots[j]._id, { order: i });
    await touch(ctx, shot.storyId);
    return null;
  },
});

// Edit a character or location in the story bible.
export const updateBibleEntry = mutation({
  args: {
    storyId: v.id("stories"),
    kind: v.union(v.literal("character"), v.literal("location")),
    id: v.string(),
    name: v.optional(v.string()),
    look: v.optional(v.string()),
    voice: v.optional(v.string()),
  },
  handler: async (ctx, { storyId, kind, id, name, look, voice }) => {
    const story = await ownStory(ctx, storyId);
    const bible = story.bible as StoryBible | undefined;
    if (!bible) throw new Error("No plan yet");
    const list = kind === "character" ? bible.characters : bible.locations;
    const item = list.find((x) => x.id === id);
    if (!item) throw new Error("Not found");
    if (name?.trim()) item.name = name.trim().slice(0, 80);
    if (look?.trim()) item.look = look.trim().slice(0, 800);
    if (voice && kind === "character" && VOICE_IDS.includes(voice)) {
      const ch = item as StoryBible["characters"][number];
      if (ch.voice !== voice) {
        await recordImplicit(ctx, { userId: story.userId, storyId, stage: "voice", rating: -1, reasons: ["Changed voice"], snapshot: `voice:${ch.voice} | replaced by ${voice}` });
        await recordImplicit(ctx, { userId: story.userId, storyId, stage: "voice", rating: 1, reasons: ["Chosen voice"], snapshot: `voice:${voice} | chosen for ${ch.name}` });
      }
      ch.voice = voice;
    }
    await touch(ctx, storyId, { bible });
    return null;
  },
});

// ── Cast (reference images) ──

export const confirmPlan = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ownStory(ctx, storyId);
    const bible = story.bible as StoryBible | undefined;
    const shots = await shotsOf(ctx, storyId);
    if (!bible || shots.length === 0) throw new Error("Generate a plan first.");
    if (shots.some((s) => !s.narration.trim() || !s.imagePrompt.trim())) {
      throw new Error("Every shot needs narration and a picture description.");
    }
    for (const c of bible.characters) {
      if (c.refStatus !== "ready") {
        c.refStatus = "queued";
        await enqueue(ctx, story, "ref", `character:${c.id}`);
      }
    }
    for (const l of bible.locations) {
      if (l.refStatus !== "ready") {
        l.refStatus = "queued";
        await enqueue(ctx, story, "ref", `location:${l.id}`);
      }
    }
    await touch(ctx, storyId, { step: "cast", bible });
    return null;
  },
});

export const redoRef = mutation({
  args: { storyId: v.id("stories"), kind: v.union(v.literal("character"), v.literal("location")), id: v.string() },
  handler: async (ctx, { storyId, kind, id }) => {
    const story = await ownStory(ctx, storyId);
    const bible = story.bible as StoryBible;
    const item = (kind === "character" ? bible.characters : bible.locations).find((x) => x.id === id);
    if (!item) throw new Error("Not found");
    item.refStatus = "queued";
    item.refError = null;
    await touch(ctx, storyId, { bible });
    await enqueue(ctx, story, "ref", `${kind}:${id}`);
    return null;
  },
});

// ── Storyboard (stills + voice) ──

export const confirmCast = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ownStory(ctx, storyId);
    const bible = story.bible as StoryBible;
    const all = [...bible.characters, ...bible.locations];
    if (all.some((x) => x.refStatus !== "ready")) throw new Error("Wait until every reference image is ready.");
    for (const shot of await shotsOf(ctx, storyId)) {
      if (shot.stillStatus !== "ready") {
        await ctx.db.patch(shot._id, { stillStatus: "queued", stillError: null });
        await enqueue(ctx, story, "still", shot._id);
      }
      if (shot.audioStatus !== "ready") {
        await ctx.db.patch(shot._id, { audioStatus: "queued", audioError: null });
        await enqueue(ctx, story, "voice", shot._id);
      }
    }
    await touch(ctx, storyId, { step: "board" });
    return null;
  },
});

export const redoShot = mutation({
  args: { shotId: v.id("storyShots"), imagePrompt: v.optional(v.string()) },
  handler: async (ctx, { shotId, imagePrompt }) => {
    const shot = await ownShot(ctx, shotId);
    const story = (await ctx.db.get(shot.storyId))!;
    if (shot.stillStatus === "ready") {
      const edited = imagePrompt?.trim() && imagePrompt.trim() !== shot.imagePrompt;
      await recordImplicit(ctx, {
        userId: story.userId,
        storyId: story._id,
        stage: "still",
        targetId: shotId,
        rating: -1,
        reasons: ["Redrawn"],
        snapshot: edited
          ? `BEFORE: ${shot.imagePrompt.slice(0, 240)}\nAFTER: ${imagePrompt!.trim().slice(0, 240)}`
          : shot.imagePrompt.slice(0, 400),
      });
    }
    await ctx.db.patch(shotId, {
      stillStatus: "queued",
      stillError: null,
      ...(imagePrompt?.trim() ? { imagePrompt: imagePrompt.trim().slice(0, 1500) } : {}),
    });
    await enqueue(ctx, story, "still", shotId);
    if (shot.audioStatus !== "ready" && shot.audioStatus !== "queued" && shot.audioStatus !== "working") {
      await ctx.db.patch(shotId, { audioStatus: "queued", audioError: null });
      await enqueue(ctx, story, "voice", shotId);
    }
    await touch(ctx, story._id);
    return null;
  },
});

export const redoVoice = mutation({
  args: { shotId: v.id("storyShots") },
  handler: async (ctx, { shotId }) => {
    const shot = await ownShot(ctx, shotId);
    const story = (await ctx.db.get(shot.storyId))!;
    if (shot.audioStatus === "ready") {
      const bible = story.bible as StoryBible | undefined;
      const voice = bible?.characters.find((c) => c.id === shot.speaker)?.voice ?? story.narratorVoice;
      await recordImplicit(ctx, {
        userId: story.userId,
        storyId: story._id,
        stage: "voice",
        targetId: shotId,
        rating: -1,
        reasons: ["Redone"],
        snapshot: `voice:${voice} | "${shot.narration.slice(0, 160)}"`,
      });
    }
    await ctx.db.patch(shotId, { audioStatus: "queued", audioError: null });
    await enqueue(ctx, story, "voice", shotId);
    return null;
  },
});

// ── Export ──

export const goToStep = mutation({
  args: { storyId: v.id("stories"), step: v.union(v.literal("script"), v.literal("plan"), v.literal("cast"), v.literal("board"), v.literal("export")) },
  handler: async (ctx, { storyId, step }) => {
    await ownStory(ctx, storyId);
    await touch(ctx, storyId, { step });
    return null;
  },
});

export const setCaptionStyle = mutation({
  args: { storyId: v.id("stories"), captionStyle: v.string() },
  handler: async (ctx, { storyId, captionStyle }) => {
    await ownStory(ctx, storyId);
    if (!["bold", "karaoke", "clean", "none"].includes(captionStyle)) throw new Error("Unknown caption style");
    await touch(ctx, storyId, { captionStyle });
    return null;
  },
});

export const exportStory = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ownStory(ctx, storyId);
    const shots = await shotsOf(ctx, storyId);
    if (shots.length === 0 || shots.some((s) => s.stillStatus !== "ready" || s.audioStatus !== "ready")) {
      throw new Error("Every shot needs a picture and voice before exporting.");
    }
    if (shots.some((s) => s.mode === "video" && (s.videoStatus === "queued" || s.videoStatus === "working"))) {
      throw new Error("Wait until every shot has finished animating.");
    }
    if (story.renderStatus === "queued" || story.renderStatus === "rendering") return null;
    await touch(ctx, storyId, { step: "export", renderStatus: "queued", renderProgress: 0, renderError: null });
    await enqueue(ctx, story, "render");
    return null;
  },
});

export const remove = mutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ownStory(ctx, storyId);
    const keys: string[] = [];
    const bible = story.bible as StoryBible | undefined;
    // Reference images that belong to a series are shared with other episodes.
    for (const x of [...(bible?.characters ?? []), ...(bible?.locations ?? [])]) {
      if (x.refKey && !x.refKey.includes("/series/")) keys.push(x.refKey);
    }
    for (const s of await shotsOf(ctx, storyId)) {
      if (s.stillKey) keys.push(s.stillKey);
      if (s.videoKey) keys.push(s.videoKey);
      if (s.audioKey) keys.push(s.audioKey);
      await ctx.db.delete(s._id);
    }
    if (story.outputKey) keys.push(story.outputKey);
    for (const k of keys) await r2.deleteObject(ctx, k).catch(() => {});
    // Feedback rows are kept: what the AI learned outlives the story (Reset clears it).
    for (const status of ["queued", "working", "done", "failed"] as const) {
      const jobs = await ctx.db
        .query("storyJobs")
        .withIndex("by_story", (q) => q.eq("storyId", storyId).eq("status", status))
        .collect();
      for (const j of jobs) await ctx.db.delete(j._id);
    }
    await ctx.db.delete(storyId);
    return null;
  },
});

// ── Phase 2: AI video per shot ──

export const setVideoModel = mutation({
  args: { storyId: v.id("stories"), model: v.string() },
  handler: async (ctx, { storyId, model }) => {
    await ownStory(ctx, storyId);
    if (!VIDEO_MODEL_IDS.includes(model as StoryVideoModel) || isTalking(model)) throw new Error("Unknown video model");
    await touch(ctx, storyId, { videoModel: model });
    return null;
  },
});

// Still ↔ video for one shot. Switching to video doesn't generate anything by itself.
export const setShotMode = mutation({
  args: { shotId: v.id("storyShots"), mode: v.union(v.literal("still"), v.literal("video")) },
  handler: async (ctx, { shotId, mode }) => {
    const shot = await ownShot(ctx, shotId);
    await ctx.db.patch(shotId, { mode });
    await touch(ctx, shot.storyId);
    return null;
  },
});

// Animate shots (all with a ready picture + voice, or the given ones).
export const makeVideos = mutation({
  args: { storyId: v.id("stories"), shotIds: v.optional(v.array(v.id("storyShots"))), model: v.optional(v.string()) },
  handler: async (ctx, { storyId, shotIds, model }) => {
    const story = await ownStory(ctx, storyId);
    const chosen = (model ?? story.videoModel ?? "kling-3-std") as StoryVideoModel;
    if (!VIDEO_MODEL_IDS.includes(chosen)) throw new Error("Unknown video model");
    const talking = isTalking(chosen);
    if (talking && !shotIds) throw new Error("Pick which shots should talk.");
    const shots = (await shotsOf(ctx, storyId)).filter((s) => !shotIds || shotIds.includes(s._id));
    let queued = 0;
    for (const s of shots) {
      if (s.stillStatus !== "ready" || s.audioStatus !== "ready") continue;
      if (s.videoStatus === "queued" || s.videoStatus === "working") continue;
      if (!shotIds && s.videoStatus === "ready" && s.videoModel === chosen) continue; // already animated
      // "Animate all" never overwrites a talking shot.
      if (!shotIds && s.mode === "video" && s.videoStatus === "ready" && isTalking(s.videoModel)) continue;
      await ctx.db.patch(s._id, { mode: "video", videoModel: chosen, videoStatus: "queued", videoError: null });
      await enqueue(ctx, story, "video", s._id);
      queued++;
    }
    if (queued === 0) throw new Error("No shots to animate: each needs a ready picture and voice.");
    await touch(ctx, storyId, { ...(talking ? {} : { videoModel: chosen }), step: "board" });
    return queued;
  },
});

export const redoVideo = mutation({
  args: { shotId: v.id("storyShots"), motionPrompt: v.optional(v.string()), model: v.optional(v.string()) },
  handler: async (ctx, { shotId, motionPrompt, model }) => {
    const shot = await ownShot(ctx, shotId);
    const story = (await ctx.db.get(shot.storyId))!;
    if (model && !VIDEO_MODEL_IDS.includes(model as StoryVideoModel)) throw new Error("Unknown video model");
    if (shot.stillStatus !== "ready" || shot.audioStatus !== "ready") throw new Error("This shot needs its picture and voice first.");
    if (shot.videoStatus === "ready") {
      await recordImplicit(ctx, {
        userId: story.userId,
        storyId: story._id,
        stage: "motion",
        targetId: shotId,
        rating: -1,
        reasons: ["Redone"],
        snapshot: motionPrompt?.trim() && motionPrompt.trim() !== shot.motionPrompt
          ? `BEFORE: ${(shot.motionPrompt ?? "").slice(0, 200)}\nAFTER: ${motionPrompt.trim().slice(0, 200)}`
          : `motion: ${(shot.motionPrompt ?? "").slice(0, 300)}`,
      });
    }
    await ctx.db.patch(shotId, {
      mode: "video",
      videoModel: model ?? shot.videoModel ?? story.videoModel ?? "kling-3-std",
      videoStatus: "queued",
      videoError: null,
      ...(motionPrompt?.trim() ? { motionPrompt: motionPrompt.trim().slice(0, 800) } : {}),
    });
    await enqueue(ctx, story, "video", shotId);
    return null;
  },
});

// ── Phase 3b: background music ──

export const setMusic = mutation({
  args: { storyId: v.id("stories"), track: v.union(v.string(), v.null()), volume: v.optional(v.number()) },
  handler: async (ctx, { storyId, track, volume }) => {
    await ownStory(ctx, storyId);
    if (track && !STORY_MUSIC.some((m) => m.id === track)) throw new Error("Unknown track");
    await touch(ctx, storyId, {
      musicTrack: track,
      ...(volume !== undefined ? { musicVolume: Math.max(0, Math.min(0.5, volume)) } : {}),
    });
    return null;
  },
});

// Music picker: every track with a short-lived signed URL for previews.
export const musicLibrary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await Promise.all(STORY_MUSIC.map(async (m) => ({ ...m, url: await r2.getUrl(MUSIC_KEY(m.id), { expiresIn: SIX_HOURS }) })));
  },
});

// Ops (admin key only, via `npx convex run`): signed PUT URL to upload a
// library track to MUSIC_KEY(id). Shared by dev and prod (same bucket).
export const musicUploadUrl = internalMutation({
  args: { id: v.string() },
  handler: async (_ctx, { id }) => {
    if (!STORY_MUSIC.some((m) => m.id === id)) throw new Error("Unknown track");
    return await r2.generateUploadUrl(MUSIC_KEY(id));
  },
});
