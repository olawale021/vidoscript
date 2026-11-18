import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { downloadUrl, r2, safeFileName, storagePrefix } from "./r2";
import { assertWorker } from "./broll";

const DAY = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // 5 GB: the most R2 accepts in one PUT

function extOf(fileName: string, contentType: string) {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]{2,4})$/);
  if (m) return m[1];
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  return "mp4";
}

async function requireUser(ctx: { auth: MutationCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

// ── User-facing ──

// Step 1 of an upload: create the source row and a signed R2 PUT URL.
export const createUpload = mutation({
  args: {
    title: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!args.contentType.startsWith("video/")) throw new Error("Please upload a video file");
    if (args.sizeBytes > MAX_UPLOAD_BYTES) throw new Error("Video is larger than 5 GB");

    const now = Date.now();
    const sourceId = await ctx.db.insert("clipSources", {
      userId,
      title: args.title.trim().slice(0, 120) || args.fileName,
      fileName: args.fileName,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
      videoKey: "", // set below once we know the id
      status: "uploading",
      progress: 0,
      error: null,
      expiresAt: now + RETENTION_DAYS * DAY,
      updatedAt: now,
    });
    const key = `${storagePrefix()}/clips/${userId}/${sourceId}/source.${extOf(args.fileName, args.contentType)}`;
    await ctx.db.patch(sourceId, { videoKey: key });
    const { url } = await r2.generateUploadUrl(key);
    return { sourceId, url };
  },
});

// Normalises a YouTube link to https://www.youtube.com/watch?v=ID (null if not YouTube).
export function youtubeUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([^/]+)/);
      if (m) id = m[2];
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

// Pasted link: queue a source the worker downloads (convex/clips.ts claimNext →
// render-worker/clip-download.mjs) before the normal ingest pipeline.
// Shared by createFromUrl and the clip scout ("Clip this").
export async function createLinkSource(
  ctx: MutationCtx,
  userId: string,
  url: string,
  extra: { title?: string; hints?: { start: number; end: number; label: string }[] } = {}
) {
  const clean = youtubeUrl(url);
  if (!clean) throw new Error("That doesn't look like a YouTube video link");
  const now = Date.now();
  const sourceId = await ctx.db.insert("clipSources", {
    userId,
    title: extra.title?.slice(0, 200) || "YouTube video",
    fileName: "youtube.mp4",
    contentType: "video/mp4",
    sizeBytes: 0,
    videoKey: "",
    sourceType: "url",
    sourceUrl: clean,
    rightsConfirmedAt: now,
    status: "checking",
    progress: 1,
    error: null,
    expiresAt: now + RETENTION_DAYS * DAY,
    updatedAt: now,
    ...(extra.hints?.length ? { hints: extra.hints.slice(0, 10) } : {}),
  });
  await ctx.db.patch(sourceId, { videoKey: `${storagePrefix()}/clips/${userId}/${sourceId}/source.mp4` });
  return sourceId;
}

export const createFromUrl = mutation({
  args: { url: v.string(), rightsConfirmed: v.boolean() },
  handler: async (ctx, { url, rightsConfirmed }) => {
    const userId = await requireUser(ctx);
    if (!rightsConfirmed) throw new Error("Please confirm you own this video or have permission to use it");
    return await createLinkSource(ctx, userId, url);
  },
});

// 👍 / 👎 on a suggested clip (+ optional quick reasons). The clip finder
// reads recent ratings as preferences the next time it picks clips.
export const rate = mutation({
  args: {
    clipId: v.id("clips"),
    rating: v.union(v.literal(1), v.literal(-1), v.literal(0)),
    reasons: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { clipId, rating, reasons }) => {
    const userId = await requireUser(ctx);
    const clip = await ctx.db.get(clipId);
    if (!clip || clip.userId !== userId) throw new Error("Not found");
    if (rating === 0) {
      await ctx.db.patch(clipId, { rating: undefined, ratingReasons: undefined, ratedAt: undefined });
    } else {
      await ctx.db.patch(clipId, {
        rating,
        ratingReasons: (reasons ?? []).map((r) => r.slice(0, 60)).slice(0, 6),
        ratedAt: Date.now(),
      });
    }
    return null;
  },
});

// Ask the AI for more clips from an already-processed video (transcript
// reused, so no new transcription cost; existing clips are kept).
export const findMore = mutation({
  args: { sourceId: v.id("clipSources") },
  handler: async (ctx, { sourceId }) => {
    const userId = await requireUser(ctx);
    const source = await ctx.db.get(sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");
    const busyMore = (source.status === "queued" || source.status === "processing") && source.findMore;
    if (source.status !== "ready" && !busyMore) throw new Error("Wait until the video has finished processing");
    // The AI learns from ratings, so every clip shown must be rated first.
    const unrated = (await ctx.db.query("clips").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect()).filter(
      (c) => !c.hidden && !c.rating
    ).length;
    if (unrated > 0) {
      throw new Error(`Rate the ${unrated} unrated clip${unrated > 1 ? "s" : ""} first (👍 or 👎) so the AI knows what to look for.`);
    }
    await ctx.db.patch(sourceId, {
      moreCount: (source.moreCount ?? 0) + 5,
      ...(busyMore ? {} : { status: "queued", findMore: true, progress: 80 }),
      error: null,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Replace a clip: it's hidden (kept as a 👎 with the reasons so the AI learns)
// and the worker finds a different moment that takes its place in the list.
export const replace = mutation({
  args: { clipId: v.id("clips"), reasons: v.array(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { clipId, reasons, note }) => {
    const userId = await requireUser(ctx);
    const clip = await ctx.db.get(clipId);
    if (!clip || clip.userId !== userId) throw new Error("Not found");
    if (clip.hidden) return null;
    const source = await ctx.db.get(clip.sourceId);
    if (!source) throw new Error("Not found");
    const busyMore = (source.status === "queued" || source.status === "processing") && source.findMore;
    if (source.status !== "ready" && !busyMore) throw new Error("Wait until the video has finished processing");
    await ctx.db.patch(clipId, {
      hidden: true,
      replacing: true,
      rating: -1,
      ratingReasons: reasons.map((r) => r.slice(0, 60)).slice(0, 8),
      ratingNote: note?.trim().slice(0, 500) || undefined,
      ratedAt: Date.now(),
    });
    await ctx.db.patch(source._id, {
      replaceIds: [...(source.replaceIds ?? []), clipId],
      ...(busyMore ? {} : { status: "queued", findMore: true, progress: 80 }),
      error: null,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Link: the user approved the estimated download size/cost.
export const confirmDownload = mutation({
  args: {
    sourceId: v.id("clipSources"),
    quality: v.optional(v.union(v.literal("360"), v.literal("480"), v.literal("720"), v.literal("1080"))),
    downloader: v.optional(v.union(v.literal("auto"), v.literal("main"), v.literal("backup"), v.literal("premium"))),
  },
  handler: async (ctx, { sourceId, quality, downloader }) => {
    const userId = await requireUser(ctx);
    const source = await ctx.db.get(sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");
    if (source.status !== "confirm") return null;
    await ctx.db.patch(sourceId, {
      status: "queued",
      error: null,
      downloader: downloader ?? "auto",
      blocked: undefined,
      progress: 2,
      downloadQuality: quality ?? "720",
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Step 2: the browser finished the PUT; queue the source for the worker.
export const markUploaded = mutation({
  args: { sourceId: v.id("clipSources") },
  handler: async (ctx, { sourceId }) => {
    const userId = await requireUser(ctx);
    const source = await ctx.db.get(sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");
    if (source.status !== "uploading") return null;
    await ctx.db.patch(sourceId, { status: "queued", progress: 2, updatedAt: Date.now() });
    return null;
  },
});

export const retry = mutation({
  args: { sourceId: v.id("clipSources") },
  handler: async (ctx, { sourceId }) => {
    const userId = await requireUser(ctx);
    const source = await ctx.db.get(sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");
    if (source.status !== "failed") return null;
    await clearDerived(ctx, sourceId);
    await ctx.db.patch(sourceId, {
      status: "queued",
      step: undefined,
      progress: 2,
      error: null,
      startedAt: undefined,
      finishedAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const sources = await ctx.db
      .query("clipSources")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(100);
    return Promise.all(
      sources.map(async (s) => {
        const clips = await ctx.db
          .query("clips")
          .withIndex("by_source", (q) => q.eq("sourceId", s._id))
          .collect();
        return {
          _id: s._id,
          title: s.title,
          status: s.status,
          step: s.step ?? null,
          progress: s.progress,
          error: s.error ?? null,
          durationSec: s.durationSec ?? null,
          stepDetail: s.stepDetail ?? null,
          downloadQuality: s.downloadQuality ?? null,
          blocked: s.blocked ?? false,
          clipCount: clips.filter((c) => !c.hidden).length,
          unratedCount: clips.filter((c) => !c.hidden && !c.rating).length,
          exportedCount: clips.filter((c) => !c.hidden && c.renderStatus === "done").length,
          createdAt: s._creationTime,
          sourceType: s.sourceType ?? "upload",
          thumbnailUrl: s.thumbnailUrl ?? null,
          channelName: s.channelName ?? null,
          estimateMb: s.estimateMb ?? null,
          estimateUsd: s.estimateUsd ?? null,
          availableQualities: s.availableQualities ?? null,
          expiresAt: s.expiresAt,
          updatedAt: s.updatedAt,
        };
      })
    );
  },
});

export const get = query({
  args: { sourceId: v.id("clipSources") },
  handler: async (ctx, { sourceId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const source = await ctx.db.get(sourceId);
    if (!source || source.userId !== identity.subject) return null;
    const clips = (
      await ctx.db
        .query("clips")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect()
    ).filter((c) => !c.hidden || c.replacing);
    const videoUrl =
      source.status === "uploading" || !source.videoKey
        ? null
        : await r2.getUrl(source.videoKey, { expiresIn: 6 * 60 * 60 });
    const withOutputs = await Promise.all(
      clips.map(async (c) => ({
        ...c,
        outputUrl: c.outputKey ? await r2.getUrl(c.outputKey, { expiresIn: 6 * 60 * 60 }) : null,
        downloadUrl: c.outputKey ? await downloadUrl(c.outputKey, safeFileName(c.title)) : null,
      }))
    );
    return {
      ...source,
      videoUrl,
      clips: withOutputs.sort((a, b) => (b.slotScore ?? b.score) - (a.slotScore ?? a.score)),
    };
  },
});

async function clearDerived(ctx: MutationCtx, sourceId: Id<"clipSources">) {
  for (const c of await ctx.db.query("clips").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect()) {
    if (c.outputKey) await r2.deleteObject(ctx, c.outputKey).catch(() => {});
    await ctx.db.delete(c._id);
  }
  for (const t of await ctx.db
    .query("clipTranscripts")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .collect()) {
    await ctx.db.delete(t._id);
  }
}

async function deleteSourceFully(ctx: MutationCtx, sourceId: Id<"clipSources">) {
  const source = await ctx.db.get(sourceId);
  if (!source) return;
  if (source.videoKey) {
    try {
      await r2.deleteObject(ctx, source.videoKey);
    } catch {
      // object may never have been uploaded
    }
  }
  await clearDerived(ctx, sourceId);
  await ctx.db.delete(sourceId);
}

export const remove = mutation({
  args: { sourceId: v.id("clipSources") },
  handler: async (ctx, { sourceId }) => {
    const userId = await requireUser(ctx);
    const source = await ctx.db.get(sourceId);
    if (!source || source.userId !== userId) throw new Error("Not found");
    if (source.status === "processing") throw new Error("Wait for processing to finish");
    await deleteSourceFully(ctx, sourceId);
    return null;
  },
});

// Daily cron: delete sources (video + transcript + clips) past their retention.
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("clipSources")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now()))
      .take(50);
    for (const s of expired) {
      if (s.status !== "processing") await deleteSourceFully(ctx, s._id);
    }
    return expired.length;
  },
});

// ── Worker-facing (shared secret) ──

// Atomically claims the oldest queued source and returns what the worker needs.
export const claimNext = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    const now = Date.now();
    let source = await ctx.db
      .query("clipSources")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .first();
    if (!source) {
      // Recover jobs left "processing" by a worker that crashed or restarted
      // (a live job updates its progress every few minutes).
      const stale = await ctx.db
        .query("clipSources")
        .withIndex("by_status", (q) => q.eq("status", "processing"))
        .filter((q) => q.lt(q.field("updatedAt"), now - 30 * 60 * 1000))
        .first();
      // A stuck "find more" keeps its clips and transcript; a stuck full run restarts clean.
      if (stale && !stale.findMore) await clearDerived(ctx, stale._id);
      source = stale;
    }
    if (!source) return null;
    await ctx.db.patch(source._id, {
      status: "processing",
      step: "extracting",
      progress: 5,
      startedAt: now,
      updatedAt: now,
    });
    // A link that was already downloaded (e.g. on Retry) is not downloaded again.
    const isUrl = source.sourceType === "url" && !(source.sizeBytes > 0) && !source.findMore;
    if (isUrl) await ctx.db.patch(source._id, { step: "downloading", progress: 2 });
    return {
      id: source._id,
      userId: source.userId,
      title: source.title,
      sourceType: isUrl ? ("url" as const) : ("upload" as const),
      sourceUrl: source.sourceUrl ?? null,
      durationSec: source.durationSec ?? null,
      findMore: !!source.findMore,
      downloadQuality: source.downloadQuality ?? "720",
      downloader: source.downloader ?? "auto",
      hints: source.hints ?? [],
      estimateMb: source.estimateMb ?? null,
      // For links the file isn't in R2 yet; the worker uploads it, then signs a GET.
      videoUrl: isUrl ? null : await r2.getUrl(source.videoKey, { expiresIn: 6 * 60 * 60 }),
    };
  },
});

// Worker: transcript + existing clips, for "find more" (no re-transcription).
export const transcriptFor = query({
  args: { secret: v.string(), sourceId: v.id("clipSources") },
  handler: async (ctx, { secret, sourceId }) => {
    assertWorker(secret);
    const chunks = await ctx.db
      .query("clipTranscripts")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    const words = chunks.sort((a, b) => a.chunk - b.chunk).flatMap((c) => c.words);
    const existing = await ctx.db.query("clips").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect();
    const source = await ctx.db.get(sourceId);
    const replaceIds = source?.replaceIds ?? [];
    return {
      words,
      durationSec: source?.durationSec ?? null,
      // Every clip (shown or replaced) is off-limits, so nothing overlaps.
      existing: existing.map((c) => ({ start: c.start, end: c.end, title: c.title })),
      // Clips the creator rejected in this video, with their reasons.
      rejected: existing
        .filter((c) => c.hidden)
        .map((c) => ({ start: c.start, end: c.end, title: c.title, reasons: c.ratingReasons ?? [], note: c.ratingNote ?? null })),
      replaceIds,
      more: source?.moreCount ?? (replaceIds.length ? 0 : 5),
    };
  },
});

// Worker: the user's recent 👍 / 👎 clips, used as examples for the clip finder.
export const preferencesFor = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, { secret, userId }) => {
    assertWorker(secret);
    const rated = await ctx.db
      .query("clips")
      .withIndex("by_user_rated", (q) => q.eq("userId", userId).gt("ratedAt", 0))
      .order("desc")
      .take(60);
    const pick = (r: 1 | -1) =>
      rated
        .filter((c) => c.rating === r)
        .slice(0, 12)
        .map((c) => ({
          title: c.title,
          hook: c.hook,
          seconds: Math.round(c.end - c.start),
          reasons: c.ratingReasons ?? [],
          note: c.ratingNote ?? null,
          text: c.text.slice(0, 220),
        }));
    return { liked: pick(1), disliked: pick(-1) };
  },
});

// Worker: next link waiting for its pre-download lookup.
export const claimNextCheck = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    const now = Date.now();
    const source = await ctx.db
      .query("clipSources")
      .withIndex("by_status", (q) => q.eq("status", "checking"))
      .first();
    if (!source) return null;
    // startedAt marks it picked up; a crashed lookup is retried after 5 min.
    if (source.startedAt && source.startedAt > now - 5 * 60 * 1000) return null;
    await ctx.db.patch(source._id, { startedAt: now });
    return { id: source._id, userId: source.userId, sourceUrl: source.sourceUrl ?? "" };
  },
});

export const setChecked = mutation({
  args: {
    secret: v.string(),
    sourceId: v.id("clipSources"),
    title: v.string(),
    durationSec: v.number(),
    thumbnailUrl: v.optional(v.string()),
    channelName: v.optional(v.string()),
    estimateMb: v.number(),
    estimateUsd: v.number(),
    availableQualities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { secret, sourceId, ...meta }) => {
    assertWorker(secret);
    await ctx.db.patch(sourceId, {
      ...meta,
      title: meta.title.slice(0, 120) || "YouTube video",
      status: "confirm",
      startedAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Worker: signed PUT for a downloaded link, then a signed GET to process it.
// Worker: every downloader failed at the picked quality. Back to the quality
// picker with an explanation, so the user decides (never a silent downgrade).
export const backToConfirm = mutation({
  args: { secret: v.string(), sourceId: v.id("clipSources"), error: v.string() },
  handler: async (ctx, { secret, sourceId, error }) => {
    assertWorker(secret);
    await ctx.db.patch(sourceId, {
      status: "confirm",
      step: undefined,
      stepDetail: undefined,
      progress: 0,
      error: error.slice(0, 300),
      blocked: true,
      startedAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const downloadTarget = mutation({
  args: { secret: v.string(), sourceId: v.id("clipSources") },
  handler: async (ctx, { secret, sourceId }) => {
    assertWorker(secret);
    const source = await ctx.db.get(sourceId);
    if (!source) throw new Error("Source not found");
    const { url } = await r2.generateUploadUrl(source.videoKey);
    return { putUrl: url };
  },
});

export const setDownloaded = mutation({
  args: {
    secret: v.string(),
    sourceId: v.id("clipSources"),
    title: v.string(),
    sizeBytes: v.number(),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, { secret, sourceId, title, sizeBytes, durationSec }) => {
    assertWorker(secret);
    const source = await ctx.db.get(sourceId);
    if (!source) throw new Error("Source not found");
    await ctx.db.patch(sourceId, {
      title: title.slice(0, 120) || source.title,
      fileName: `${(title || "youtube").slice(0, 80)}.mp4`,
      sizeBytes,
      ...(durationSec ? { durationSec } : {}),
      progress: 5,
      updatedAt: Date.now(),
    });
    return { videoUrl: await r2.getUrl(source.videoKey, { expiresIn: 6 * 60 * 60 }) };
  },
});

export const setStep = mutation({
  args: {
    secret: v.string(),
    sourceId: v.id("clipSources"),
    step: v.union(v.literal("downloading"), v.literal("extracting"), v.literal("transcribing"), v.literal("finding")),
    progress: v.number(),
    durationSec: v.optional(v.number()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { secret, sourceId, step, progress, durationSec, detail }) => {
    assertWorker(secret);
    await ctx.db.patch(sourceId, {
      step,
      stepDetail: detail?.slice(0, 160),
      progress: Math.max(0, Math.min(99, Math.round(progress))),
      ...(durationSec !== undefined ? { durationSec } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const saveTranscriptChunk = mutation({
  args: {
    secret: v.string(),
    sourceId: v.id("clipSources"),
    chunk: v.number(),
    words: v.array(v.object({ w: v.string(), s: v.number(), e: v.number() })),
  },
  handler: async (ctx, { secret, sourceId, chunk, words }) => {
    assertWorker(secret);
    await ctx.db.insert("clipTranscripts", { sourceId, chunk, words });
    return null;
  },
});

export const saveClips = mutation({
  args: {
    secret: v.string(),
    sourceId: v.id("clipSources"),
    clips: v.array(
      v.object({
        start: v.number(),
        end: v.number(),
        title: v.string(),
        hook: v.string(),
        reason: v.string(),
        score: v.number(),
        text: v.string(),
      })
    ),
    append: v.optional(v.boolean()), // "find more": keep existing clips
    // Replace: the first clips fill these slots, in order; leftovers are restored.
    replaced: v.optional(v.array(v.id("clips"))),
    moreDone: v.optional(v.number()),
  },
  handler: async (ctx, { secret, sourceId, clips, append, replaced, moreDone }) => {
    assertWorker(secret);
    const source = await ctx.db.get(sourceId);
    if (!source) return null;
    if (!append) {
      for (const c of await ctx.db.query("clips").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect()) {
        if (c.outputKey) await r2.deleteObject(ctx, c.outputKey).catch(() => {});
        await ctx.db.delete(c._id);
      }
    }
    // Every new clip gets smart edits generated by the worker (convex/smartEdit.ts).
    const queuedAt = Date.now();
    const slots = replaced ?? [];
    // New clips start from the user's saved editor defaults (Settings).
    const prefs = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", source.userId))
      .first();
    const editorDefaults = prefs
      ? {
          ...(prefs.defaultClipAspect ? { aspect: prefs.defaultClipAspect } : {}),
          ...(prefs.defaultFraming ? { framing: prefs.defaultFraming } : {}),
          ...(prefs.defaultFitBackground ? { fitBackground: prefs.defaultFitBackground } : {}),
          ...(prefs.defaultCaptionStyle ? { captionStyle: prefs.defaultCaptionStyle } : {}),
        }
      : {};
    let unfilled = 0;
    for (let i = 0; i < slots.length; i++) {
      const old = await ctx.db.get(slots[i]);
      if (old) await ctx.db.patch(old._id, i < clips.length ? { replacing: false } : { replacing: false, hidden: false });
      if (i >= clips.length) unfilled++;
    }
    for (let i = 0; i < clips.length; i++) {
      const old = i < slots.length ? await ctx.db.get(slots[i]) : null;
      await ctx.db.insert("clips", {
        ...editorDefaults,
        ...clips[i],
        sourceId,
        userId: source.userId,
        smartStatus: "queued",
        smartQueuedAt: queuedAt,
        ...(old ? { replacesClipId: old._id, slotScore: old.slotScore ?? old.score } : {}),
      });
    }
    // Requests that arrived while this job ran are picked up by the next run.
    const fresh = (await ctx.db.get(sourceId))!;
    const leftIds = (fresh.replaceIds ?? []).filter((id) => !slots.includes(id));
    const leftMore = Math.max(0, (fresh.moreCount ?? 0) - (moreDone ?? 0));
    const again = append && (leftIds.length > 0 || leftMore > 0);
    const now = Date.now();
    await ctx.db.patch(sourceId, {
      status: again ? "queued" : "ready",
      step: undefined,
      progress: again ? 80 : 100,
      error: unfilled ? `Couldn't find a different moment for ${unfilled} clip${unfilled > 1 ? "s" : ""}, so ${unfilled > 1 ? "they were" : "it was"} kept.` : null,
      findMore: again ? true : undefined,
      replaceIds: leftIds.length ? leftIds : undefined,
      moreCount: leftMore || undefined,
      finishedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const fail = mutation({
  args: { secret: v.string(), sourceId: v.id("clipSources"), error: v.string() },
  handler: async (ctx, { secret, sourceId, error }) => {
    assertWorker(secret);
    const now = Date.now();
    // A failed "find more" keeps the video ready with its existing clips.
    const src = await ctx.db.get(sourceId);
    if (src?.findMore) {
      for (const id of src.replaceIds ?? []) {
        const c = await ctx.db.get(id);
        if (c) await ctx.db.patch(id, { hidden: false, replacing: false });
      }
      await ctx.db.patch(sourceId, {
        replaceIds: undefined,
        moreCount: undefined,
        status: "ready",
        step: undefined,
        progress: 100,
        findMore: undefined,
        error: error.slice(0, 500),
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.patch(sourceId, {
      status: "failed",
      error: error.slice(0, 500),
      finishedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

// Ops (CLI only): put a stuck "processing" source back in the queue now
// instead of waiting for the 30-minute recovery.
//   npx convex run clips:requeueStuck '{"sourceId":"..."}'
export const requeueStuck = internalMutation({
  args: { sourceId: v.id("clipSources") },
  handler: async (ctx, { sourceId }) => {
    const s = await ctx.db.get(sourceId);
    if (!s || s.status !== "processing") return "not processing";
    if (!s.findMore) await clearDerived(ctx, sourceId);
    await ctx.db.patch(sourceId, { status: "queued", updatedAt: Date.now() });
    return "requeued";
  },
});

// Worker shutdown (deploy/restart): put an in-flight source back in the queue
// right away instead of waiting for the 30-minute stale recovery.
export const releaseSource = mutation({
  args: { secret: v.string(), sourceId: v.id("clipSources") },
  handler: async (ctx, { secret, sourceId }) => {
    assertWorker(secret);
    const s = await ctx.db.get(sourceId);
    if (!s || s.status !== "processing") return null;
    if (!s.findMore) await clearDerived(ctx, sourceId);
    await ctx.db.patch(sourceId, { status: "queued", updatedAt: Date.now() });
    return null;
  },
});

// Sidebar: is any of the user's videos being processed right now (live dot)?
export const busyCount = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const recent = await ctx.db
      .query("clipSources")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(20);
    return recent.filter((s) => s.status === "queued" || s.status === "processing" || s.status === "checking").length;
  },
});
