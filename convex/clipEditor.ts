import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { aiShotUrls, downloadUrl, r2, safeFileName, SIX_HOURS, storagePrefix } from "./r2";
import { assertWorker } from "./broll";

// Clip editor + export (Phase 2). Clips come from convex/clips.ts; this file
// handles editing their settings, caption text and rendering them to MP4.

const aspectV = v.union(v.literal("9:16"), v.literal("1:1"), v.literal("16:9"));
const styleV = v.union(v.literal("bold"), v.literal("karaoke"), v.literal("clean"), v.literal("none"));
const positionV = v.union(v.literal("top"), v.literal("middle"), v.literal("bottom"));

type Word = { w: string; s: number; e: number };

const MIN_LEN = 3;
const MAX_LEN = 180;

async function sourceWords(ctx: QueryCtx, sourceId: Id<"clipSources">, from: number, to: number): Promise<Word[]> {
  const chunks = await ctx.db
    .query("clipTranscripts")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .collect();
  const out: Word[] = [];
  for (const c of chunks.sort((a, b) => a.chunk - b.chunk)) {
    for (const w of c.words) if (w.e > from && w.s < to) out.push(w);
  }
  return out;
}

// Transcript words in [from, to], with the clip's caption edits applied.
async function clipWords(ctx: QueryCtx, clip: Doc<"clips">, from: number, to: number): Promise<Word[]> {
  const words = await sourceWords(ctx, clip.sourceId, from, to);
  if (!clip.captionWords || !clip.captionRange) return words;
  const { s, e } = clip.captionRange;
  return [
    ...words.filter((w) => w.e <= s || w.s >= e),
    ...clip.captionWords.filter((w) => w.e > from && w.s < to),
  ].sort((a, b) => a.s - b.s);
}

// Render jobs get the AI shots' signed URLs baked into assetUrl.
async function withAiShotUrls(smart: unknown) {
  const urls = await aiShotUrls(smart);
  const s = smart as { broll: { id: string }[] };
  return { ...s, broll: s.broll.map((b) => (urls[b.id] ? { ...b, assetUrl: urls[b.id] } : b)) };
}

async function ownClip(ctx: QueryCtx, clipId: Id<"clips">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  const clip = await ctx.db.get(clipId);
  if (!clip || clip.userId !== identity.subject) throw new Error("Not found");
  return clip;
}

// Everything the editor needs: clip settings, source video URL, and words in
// a window around the clip so trimming outward still shows captions.
export const editorData = query({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const clip = await ctx.db.get(clipId);
    if (!clip || clip.userId !== identity.subject) return null;
    const source = await ctx.db.get(clip.sourceId);
    if (!source) return null;
    const windowStart = Math.max(0, clip.start - 60);
    const windowEnd = Math.min(source.durationSec ?? clip.end + 60, clip.end + 60);
    return {
      clip,
      source: { _id: source._id, title: source.title, durationSec: source.durationSec ?? null },
      videoUrl: await r2.getUrl(source.videoKey, { expiresIn: SIX_HOURS }),
      outputUrl: clip.outputKey ? await r2.getUrl(clip.outputKey, { expiresIn: SIX_HOURS }) : null,
      downloadUrl: clip.outputKey ? await downloadUrl(clip.outputKey, safeFileName(clip.title)) : null,
      window: { start: windowStart, end: windowEnd },
      aiShotUrls: await aiShotUrls(clip.smart),
      words: await clipWords(ctx, clip, windowStart, windowEnd),
    };
  },
});

export const update = mutation({
  args: {
    clipId: v.id("clips"),
    title: v.optional(v.string()),
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    aspect: v.optional(aspectV),
    captionStyle: v.optional(styleV),
    captionPosition: v.optional(positionV),
    cropX: v.optional(v.number()),
    framing: v.optional(v.union(v.literal("fill"), v.literal("fit"))),
    fitBackground: v.optional(v.union(v.literal("black"), v.literal("blur"))),
  },
  handler: async (ctx, { clipId, ...patch }) => {
    const clip = await ownClip(ctx, clipId);
    const source = await ctx.db.get(clip.sourceId);
    const duration = source?.durationSec ?? Number.MAX_SAFE_INTEGER;
    const start = Math.max(0, patch.start ?? clip.start);
    const end = Math.min(duration, patch.end ?? clip.end);
    if (end - start < MIN_LEN) throw new Error(`Clips must be at least ${MIN_LEN} seconds`);
    if (end - start > MAX_LEN) throw new Error(`Clips can be at most ${MAX_LEN} seconds`);
    await ctx.db.patch(clipId, {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 100) || clip.title } : {}),
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      ...(patch.aspect ? { aspect: patch.aspect } : {}),
      ...(patch.captionStyle ? { captionStyle: patch.captionStyle } : {}),
      ...(patch.captionPosition ? { captionPosition: patch.captionPosition } : {}),
      ...(patch.cropX !== undefined ? { cropX: Math.max(0, Math.min(1, patch.cropX)) } : {}),
      ...(patch.framing ? { framing: patch.framing } : {}),
      ...(patch.fitBackground ? { fitBackground: patch.fitBackground } : {}),
    });
    return null;
  },
});

// Replace the caption text for the clip's current range. Same word count keeps
// the original timings; otherwise the new words are spread evenly over the
// time the speech occupied.
export const setCaptionText = mutation({
  args: { clipId: v.id("clips"), text: v.string() },
  handler: async (ctx, { clipId, text }) => {
    const clip = await ownClip(ctx, clipId);
    const current = await clipWords(ctx, clip, clip.start, clip.end);
    const tokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean).slice(0, 2000);
    if (tokens.length === 0) {
      await ctx.db.patch(clipId, { captionWords: [], captionRange: { s: clip.start, e: clip.end } });
      return null;
    }
    let words: Word[];
    if (current.length === tokens.length) {
      words = current.map((w, i) => ({ ...w, w: tokens[i] }));
    } else {
      const s = current[0]?.s ?? clip.start;
      const e = current[current.length - 1]?.e ?? clip.end;
      const step = (e - s) / tokens.length;
      words = tokens.map((w, i) => ({
        w,
        s: Math.round((s + i * step) * 100) / 100,
        e: Math.round((s + (i + 1) * step) * 100) / 100,
      }));
    }
    // Keep earlier edits outside this clip's current range.
    const keep = (clip.captionWords ?? []).filter((w) => w.e <= clip.start || w.s >= clip.end);
    const range = clip.captionRange
      ? { s: Math.min(clip.captionRange.s, clip.start), e: Math.max(clip.captionRange.e, clip.end) }
      : { s: clip.start, e: clip.end };
    await ctx.db.patch(clipId, {
      captionWords: [...keep, ...words].sort((a, b) => a.s - b.s),
      captionRange: range,
      text: tokens.join(" ").slice(0, 5000),
    });
    return null;
  },
});

export const resetCaptions = mutation({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }) => {
    await ownClip(ctx, clipId);
    await ctx.db.patch(clipId, { captionWords: undefined, captionRange: undefined });
    return null;
  },
});

export const exportClip = mutation({
  args: { clipId: v.id("clips") },
  handler: async (ctx, { clipId }) => {
    const clip = await ownClip(ctx, clipId);
    if (clip.renderStatus === "queued" || clip.renderStatus === "rendering") return null;
    const now = Date.now();
    await ctx.db.patch(clipId, {
      renderStatus: "queued",
      renderProgress: 0,
      renderError: null,
      renderQueuedAt: now,
      renderStartedAt: undefined,
      renderFinishedAt: undefined,
    });
    return null;
  },
});

// ── Worker-facing (shared secret) ──

export const claimNextRender = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    const now = Date.now();
    let clip = await ctx.db
      .query("clips")
      .withIndex("by_render_status", (q) => q.eq("renderStatus", "queued"))
      .first();
    if (!clip) {
      // Recover renders orphaned by a worker restart.
      clip = await ctx.db
        .query("clips")
        .withIndex("by_render_status", (q) => q.eq("renderStatus", "rendering"))
        .filter((q) => q.lt(q.field("renderStartedAt"), now - 30 * 60 * 1000))
        .first();
    }
    if (!clip) return null;
    const source = await ctx.db.get(clip.sourceId);
    if (!source) {
      await ctx.db.patch(clip._id, { renderStatus: "failed", renderError: "Source video was deleted" });
      return null;
    }
    await ctx.db.patch(clip._id, {
      renderStatus: "rendering",
      renderProgress: 1,
      renderStartedAt: now,
      renderedAspect: clip.aspect ?? "9:16",
      renderedFraming: clip.framing ?? "fit",
    });
    const words = await clipWords(ctx, clip, clip.start, clip.end);
    return {
      id: clip._id,
      userId: clip.userId,
      title: clip.title,
      sourceUrl: await r2.getUrl(source.videoKey, { expiresIn: SIX_HOURS }),
      start: clip.start,
      end: clip.end,
      aspect: clip.aspect ?? "9:16",
      captionStyle: clip.captionStyle ?? "bold",
      captionPosition: clip.captionPosition ?? "bottom",
      cropX: clip.cropX ?? 0.5,
      framing: clip.framing ?? "fit",
      fitBackground: clip.fitBackground ?? "blur",
      words: words.map((w) => ({ w: w.w, s: w.s, e: w.e })), // source seconds
      smart: clip.smart ? await withAiShotUrls(clip.smart) : null,
    };
  },
});

export const renderProgress = mutation({
  args: { secret: v.string(), clipId: v.id("clips"), progress: v.number() },
  handler: async (ctx, { secret, clipId, progress }) => {
    assertWorker(secret);
    await ctx.db.patch(clipId, { renderProgress: Math.max(0, Math.min(99, Math.round(progress))) });
    return null;
  },
});

export const generateRenderUpload = mutation({
  args: { secret: v.string(), clipId: v.id("clips") },
  handler: async (ctx, { secret, clipId }) => {
    assertWorker(secret);
    const clip = await ctx.db.get(clipId);
    if (!clip) throw new Error("Clip not found");
    const key = `${storagePrefix()}/clips/${clip.userId}/${clip.sourceId}/renders/${clipId}-${Date.now()}.mp4`;
    const { url } = await r2.generateUploadUrl(key);
    return { url, key };
  },
});

export const saveRender = mutation({
  args: { secret: v.string(), clipId: v.id("clips"), key: v.string() },
  handler: async (ctx, { secret, clipId, key }) => {
    assertWorker(secret);
    const clip = await ctx.db.get(clipId);
    if (!clip) return null;
    if (clip.outputKey && clip.outputKey !== key) await r2.deleteObject(ctx, clip.outputKey).catch(() => {});
    await ctx.db.patch(clipId, {
      renderStatus: "done",
      renderProgress: 100,
      renderError: null,
      outputKey: key,
      renderFinishedAt: Date.now(),
    });
    return null;
  },
});

export const failRender = mutation({
  args: { secret: v.string(), clipId: v.id("clips"), error: v.string() },
  handler: async (ctx, { secret, clipId, error }) => {
    assertWorker(secret);
    await ctx.db.patch(clipId, {
      renderStatus: "failed",
      renderError: error.slice(0, 500),
      renderFinishedAt: Date.now(),
    });
    return null;
  },
});

export const releaseRender = mutation({
  args: { secret: v.string(), clipId: v.id("clips") },
  handler: async (ctx, { secret, clipId }) => {
    assertWorker(secret);
    const c = await ctx.db.get(clipId);
    if (c?.renderStatus === "rendering") await ctx.db.patch(clipId, { renderStatus: "queued", renderProgress: 0 });
    return null;
  },
});

// Social post copy for a clip: caption + exactly 5 hashtags (editable).
export const setPostCopy = mutation({
  args: { clipId: v.id("clips"), caption: v.string(), hashtags: v.array(v.string()) },
  handler: async (ctx, { clipId, caption, hashtags }) => {
    await ownClip(ctx, clipId);
    const tags = hashtags
      .map((h) => "#" + h.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
      .filter((h) => h.length > 1)
      .slice(0, 5);
    await ctx.db.patch(clipId, { postCaption: caption.slice(0, 2200), hashtags: tags });
    return null;
  },
});
