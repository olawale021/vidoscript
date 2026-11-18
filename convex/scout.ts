import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { createLinkSource } from "./clips";
import { channelTastePoints, scoreVideo, tastePoints, withTaste, utcDay, QUOTA_SCAN_LIMIT } from "./scoutLib";
import type { MutationCtx } from "./_generated/server";

// Clip scout: the user's targets (keywords + channels) and the YouTube videos
// found for them, ranked by clip score. YouTube calls live in scoutNode.ts.

const MAX_TARGETS = 30;
const EVERY = [3, 6, 12, 24];

async function requireUser(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

async function ownVideo(ctx: QueryCtx, id: Id<"scoutVideos">) {
  const userId = await requireUser(ctx);
  const v = await ctx.db.get(id);
  if (!v || v.userId !== userId) throw new Error("Not found");
  return v;
}

// ── Taste (the user's 👍/👎) ──

async function channelPts(ctx: QueryCtx, userId: string, channelId: string) {
  const rows = await ctx.db
    .query("scoutVideos")
    .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
    .take(100);
  return channelTastePoints(rows);
}

// Recompute a row's score from its stored stats + the user's taste.
async function rescore(ctx: MutationCtx, row: Doc<"scoutVideos">, patch: Partial<Doc<"scoutVideos">> = {}, cache?: Map<string, number>) {
  const next = { ...row, ...patch };
  let ch = cache?.get(next.channelId);
  if (ch === undefined) {
    ch = await channelPts(ctx, next.userId, next.channelId);
    cache?.set(next.channelId, ch);
  }
  const base = scoreVideo({
    publishedAt: next.publishedAt,
    durationSec: next.durationSec,
    views: next.views,
    likes: next.likes,
    comments: next.comments,
    channelMedianViews: next.channelMedianViews,
    title: next.title,
    moments: next.moments,
    competitionShorts: next.competition?.shorts ?? null,
  });
  const { score, breakdown } = withTaste(base, tastePoints(ch, next.fit));
  await ctx.db.patch(row._id, { ...patch, score, breakdown, updatedAt: Date.now() });
}

async function rescoreChannel(ctx: MutationCtx, row: Doc<"scoutVideos">) {
  const same = await ctx.db
    .query("scoutVideos")
    .withIndex("by_user_channel", (q) => q.eq("userId", row.userId).eq("channelId", row.channelId))
    .take(100);
  const cache = new Map<string, number>();
  for (const x of same) await rescore(ctx, x, {}, cache);
}

const reasonsClean = (xs: string[]) => xs.slice(0, 8).map((r) => r.slice(0, 40));

// 👍 / 👎 a found video (rating 0 clears). Re-ranks the same channel's videos.
export const rate = mutation({
  args: { id: v.id("scoutVideos"), rating: v.number(), reasons: v.array(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, { id, rating, reasons, note }) => {
    const row = await ownVideo(ctx, id);
    const r = rating > 0 ? 1 : rating < 0 ? -1 : 0;
    await ctx.db.patch(id, {
      rating: r || undefined,
      ratingReasons: r ? reasonsClean(reasons) : undefined,
      ratingNote: r ? note?.trim().slice(0, 300) || undefined : undefined,
      ratedAt: r ? Date.now() : undefined,
    });
    await rescoreChannel(ctx, row);
    return null;
  },
});

// What the AI learns from: recent explicit ratings + videos the user clipped.
export const tasteProfile = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<{ likes: string[]; dislikes: string[]; keywords: string[]; niches: string[] }> => {
    const rated = await ctx.db
      .query("scoutVideos")
      .withIndex("by_user_rated", (q) => q.eq("userId", userId).gt("ratedAt", 0))
      .order("desc")
      .take(60);
    const line = (x: Doc<"scoutVideos">) =>
      `"${x.title.slice(0, 120)}" (${x.channelTitle}, ${Math.round(x.durationSec / 60)} min)` +
      (x.ratingReasons?.length ? ` — ${x.ratingReasons.join(", ")}` : "") +
      (x.ratingNote ? ` — note: ${x.ratingNote}` : "");
    const likes = rated.filter((x) => x.rating === 1).slice(0, 15).map(line);
    const dislikes = rated.filter((x) => x.rating === -1).slice(0, 15).map(line);
    if (likes.length < 15) {
      const clipped = (
        await ctx.db.query("scoutVideos").withIndex("by_user_score", (q) => q.eq("userId", userId)).order("desc").take(300)
      ).filter((x) => x.status === "clipped" && !x.rating);
      likes.push(...clipped.slice(0, 15 - likes.length).map((x) => `${line(x)} — clipped it`));
    }
    const keywords = (await ctx.db.query("scoutTargets").withIndex("by_user", (q) => q.eq("userId", userId)).collect())
      .filter((t) => t.kind === "keyword")
      .map((t) => t.query);
    const settings = await ctx.db.query("userSettings").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    return { likes, dislikes, keywords, niches: settings?.niches ?? [] };
  },
});

// ── Targets ──

export const targets = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db
      .query("scoutTargets")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("asc")
      .take(MAX_TARGETS);
  },
});

export const addKeyword = mutation({
  args: { query: v.string() },
  handler: async (ctx, { query: q }) => {
    const userId = await requireUser(ctx);
    const text = q.trim().slice(0, 100);
    if (text.length < 2) throw new Error("Type a keyword or topic.");
    const existing = await ctx.db.query("scoutTargets").withIndex("by_user", (x) => x.eq("userId", userId)).collect();
    if (existing.length >= MAX_TARGETS) throw new Error(`Up to ${MAX_TARGETS} keywords and channels.`);
    if (existing.some((t) => t.kind === "keyword" && t.query.toLowerCase() === text.toLowerCase())) return null;
    return await ctx.db.insert("scoutTargets", {
      userId,
      kind: "keyword",
      query: text,
      clipFriendly: false,
      everyHours: 6,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const updateTarget = mutation({
  args: {
    targetId: v.id("scoutTargets"),
    clipFriendly: v.optional(v.boolean()),
    enabled: v.optional(v.boolean()),
    everyHours: v.optional(v.number()),
  },
  handler: async (ctx, { targetId, ...patch }) => {
    const userId = await requireUser(ctx);
    const t = await ctx.db.get(targetId);
    if (!t || t.userId !== userId) throw new Error("Not found");
    if (patch.everyHours !== undefined && !EVERY.includes(patch.everyHours)) throw new Error("Choose 3, 6, 12 or 24 hours.");
    await ctx.db.patch(targetId, patch);
    // Clip-friendly is a channel property: reflect it on that channel's videos.
    if (patch.clipFriendly !== undefined && t.kind === "channel" && t.channelId) {
      const vids = await ctx.db.query("scoutVideos").withIndex("by_user_score", (q) => q.eq("userId", userId)).collect();
      for (const v of vids) if (v.channelId === t.channelId) await ctx.db.patch(v._id, { clipFriendly: patch.clipFriendly });
    }
    return null;
  },
});

export const removeTarget = mutation({
  args: { targetId: v.id("scoutTargets") },
  handler: async (ctx, { targetId }) => {
    const userId = await requireUser(ctx);
    const t = await ctx.db.get(targetId);
    if (!t || t.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(targetId);
    return null;
  },
});

// ── Results ──

export const list = query({
  args: {
    status: v.optional(v.union(v.literal("new"), v.literal("saved"), v.literal("clipped"), v.literal("dismissed"))),
    minScore: v.optional(v.number()),
    clipFriendlyOnly: v.optional(v.boolean()),
    maxAgeDays: v.optional(v.number()),
    minViews: v.optional(v.number()),
    sort: v.optional(v.union(v.literal("score"), v.literal("views"), v.literal("velocity"))),
  },
  handler: async (ctx, { status, minScore, clipFriendlyOnly, maxAgeDays, minViews, sort }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("scoutVideos")
      .withIndex("by_user_score", (q) => q.eq("userId", identity.subject).gte("score", minScore ?? 0))
      .order("desc")
      .take(1500);
    const cutoff = maxAgeDays ? Date.now() - maxAgeDays * 86_400_000 : 0;
    const perHour = (r: Doc<"scoutVideos">) => r.views / Math.max(1, (Date.now() - r.publishedAt) / 3_600_000);
    const out = rows
      .filter((r) => (status ? r.status === status : r.status === "new" || r.status === "saved"))
      .filter((r) => !clipFriendlyOnly || r.clipFriendly)
      .filter((r) => r.publishedAt >= cutoff)
      .filter((r) => !minViews || r.views >= minViews);
    if (sort === "views") out.sort((a, b) => b.views - a.views);
    else if (sort === "velocity") out.sort((a, b) => perHour(b) - perHour(a));
    return out.slice(0, 100);
  },
});

export const setStatus = mutation({
  args: { id: v.id("scoutVideos"), status: v.union(v.literal("new"), v.literal("saved"), v.literal("dismissed")) },
  handler: async (ctx, { id, status }) => {
    const row = await ownVideo(ctx, id);
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    await rescoreChannel(ctx, row);
    return null;
  },
});

// "Clip this": start the normal link-clipping flow (quality card on the Clips
// page) with the scout's moments as hints for the clip finder.
export const clipThis = mutation({
  args: { id: v.id("scoutVideos"), rightsConfirmed: v.boolean() },
  handler: async (ctx, { id, rightsConfirmed }) => {
    const video = await ownVideo(ctx, id);
    if (!rightsConfirmed) throw new Error("Please confirm you own this video or have permission to use it");
    if (video.clipSourceId && (await ctx.db.get(video.clipSourceId))) return video.clipSourceId;
    const hints = video.moments
      .slice()
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 6)
      .map((m) => ({ start: Math.max(0, m.t - 10), end: m.t + 40, label: m.label.slice(0, 90) }));
    const sourceId = await createLinkSource(ctx, video.userId, `https://www.youtube.com/watch?v=${video.videoId}`, {
      title: video.title,
      hints,
    });
    await ctx.db.patch(id, { status: "clipped", clipSourceId: sourceId, updatedAt: Date.now() });
    await rescoreChannel(ctx, video);
    return sourceId;
  },
});

// Totals for the Discover header and filter tabs.
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db
      .query("scoutVideos")
      .withIndex("by_user_score", (q) => q.eq("userId", identity.subject))
      .take(5000);
    const dayAgo = Date.now() - 86_400_000;
    const c = { total: rows.length, new: 0, saved: 0, clipped: 0, dismissed: 0, today: 0, strong: 0 };
    for (const r of rows) {
      c[r.status] += 1;
      if (r.firstSeenAt >= dayAgo && r.status !== "dismissed") c.today += 1;
      if (r.score >= 70 && (r.status === "new" || r.status === "saved")) c.strong += 1;
    }
    return c;
  },
});

// Header: today's YouTube quota and this month's scout spend.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const quota = await ctx.db.query("scoutQuota").withIndex("by_day", (q) => q.eq("day", utcDay())).first();
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject).gte("createdAt", start))
      .collect();
    const spend = rows.filter((r) => r.feature.startsWith("scout.")).reduce((s, r) => s + r.costUsd, 0);
    return {
      unitsToday: quota?.units ?? 0,
      unitsLimit: 10_000,
      scanLimit: QUOTA_SCAN_LIMIT,
      spendMonth: Math.round(spend * 100) / 100,
      hasKey: !!process.env.YOUTUBE_API_KEY,
      rated: (
        await ctx.db
          .query("scoutVideos")
          .withIndex("by_user_rated", (q) => q.eq("userId", identity.subject).gt("ratedAt", 0))
          .take(500)
      ).length,
    };
  },
});

// ── Internal (used by scoutNode.ts) ──

export const quotaUsed = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("scoutQuota").withIndex("by_day", (q) => q.eq("day", utcDay())).first())?.units ?? 0,
});

export const addQuota = internalMutation({
  args: { units: v.number() },
  handler: async (ctx, { units }) => {
    const day = utcDay();
    const row = await ctx.db.query("scoutQuota").withIndex("by_day", (q) => q.eq("day", day)).first();
    if (row) await ctx.db.patch(row._id, { units: row.units + units });
    else await ctx.db.insert("scoutQuota", { day, units });
    return null;
  },
});

export const getTarget = internalQuery({
  args: { targetId: v.id("scoutTargets") },
  handler: async (ctx, { targetId }) => await ctx.db.get(targetId),
});

export const userTargets = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) =>
    (await ctx.db.query("scoutTargets").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).filter((t) => t.enabled),
});

// Targets whose next scan is due (oldest first).
export const dueTargets = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("scoutTargets")
      .withIndex("by_due", (q) => q.eq("enabled", true))
      .order("asc")
      .take(200);
    return rows.filter((t) => !t.lastScannedAt || t.lastScannedAt < now - t.everyHours * 3_600_000).slice(0, limit);
  },
});

export const insertChannelTarget = internalMutation({
  args: {
    userId: v.string(),
    query: v.string(),
    channelId: v.string(),
    channelTitle: v.string(),
    uploadsPlaylistId: v.string(),
    clipFriendly: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("scoutTargets").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect();
    if (existing.length >= MAX_TARGETS) throw new Error(`Up to ${MAX_TARGETS} keywords and channels.`);
    const dup = existing.find((t) => t.channelId === args.channelId);
    if (dup) return dup._id;
    return await ctx.db.insert("scoutTargets", {
      ...args,
      kind: "channel",
      everyHours: 6,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const markScanned = internalMutation({
  args: { targetId: v.id("scoutTargets"), error: v.optional(v.string()) },
  handler: async (ctx, { targetId, error }) => {
    if (await ctx.db.get(targetId)) await ctx.db.patch(targetId, { lastScannedAt: Date.now(), lastError: error ?? null });
    return null;
  },
});

// The target owner's Discover settings (time window + language).
export const scanSettings = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<{ windowDays: number; language: "en" | "any" }> => {
    const row = await ctx.db.query("userSettings").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    return { windowDays: row?.discoverWindowDays ?? 7, language: row?.discoverLanguage ?? "en" };
  },
});

export const channelCache = internalQuery({
  args: { channelIds: v.array(v.string()) },
  handler: async (ctx, { channelIds }) => {
    const out: Doc<"scoutChannels">[] = [];
    for (const id of channelIds) {
      const row = await ctx.db.query("scoutChannels").withIndex("by_channel", (q) => q.eq("channelId", id)).first();
      if (row) out.push(row);
    }
    return out;
  },
});

export const saveChannels = internalMutation({
  args: {
    channels: v.array(
      v.object({
        channelId: v.string(),
        title: v.string(),
        uploadsPlaylistId: v.string(),
        medianViews: v.union(v.number(), v.null()),
        country: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { channels }) => {
    for (const c of channels) {
      const row = await ctx.db.query("scoutChannels").withIndex("by_channel", (q) => q.eq("channelId", c.channelId)).first();
      if (row) await ctx.db.patch(row._id, { ...c, updatedAt: Date.now() });
      else await ctx.db.insert("scoutChannels", { ...c, updatedAt: Date.now() });
    }
    return null;
  },
});

// Which of these videos the user already has (to keep their status, AI note,
// heatmap and competition when re-scanning).
export const knownVideos = internalQuery({
  args: { userId: v.string(), videoIds: v.array(v.string()) },
  handler: async (ctx, { userId, videoIds }) => {
    const out: Doc<"scoutVideos">[] = [];
    for (const videoId of videoIds) {
      const row = await ctx.db
        .query("scoutVideos")
        .withIndex("by_user_video", (q) => q.eq("userId", userId).eq("videoId", videoId))
        .first();
      if (row) out.push(row);
    }
    return out;
  },
});

const momentV = v.object({ t: v.number(), label: v.string(), mentions: v.number(), source: v.string() });

export const upsertVideos = internalMutation({
  args: {
    userId: v.string(),
    targetId: v.id("scoutTargets"),
    clipFriendly: v.boolean(),
    videos: v.array(
      v.object({
        videoId: v.string(),
        title: v.string(),
        channelId: v.string(),
        channelTitle: v.string(),
        thumbnail: v.optional(v.string()),
        publishedAt: v.number(),
        durationSec: v.number(),
        views: v.number(),
        likes: v.number(),
        comments: v.number(),
        channelMedianViews: v.optional(v.number()),
        score: v.number(),
        breakdown: v.any(),
        moments: v.optional(v.array(momentV)), // undefined = keep existing
      })
    ),
  },
  handler: async (ctx, { userId, targetId, clipFriendly, videos: raw }) => {
    const now = Date.now();
    const cache = new Map<string, number>();
    for (const r of raw) {
      const row = await ctx.db
        .query("scoutVideos")
        .withIndex("by_user_video", (q) => q.eq("userId", userId).eq("videoId", r.videoId))
        .first();
      // The scan's score is stats-only; add the user's taste.
      let ch = cache.get(r.channelId);
      if (ch === undefined) {
        ch = await channelPts(ctx, userId, r.channelId);
        cache.set(r.channelId, ch);
      }
      const v = { ...r, ...withTaste({ score: r.score, breakdown: r.breakdown ?? {} }, tastePoints(ch, row?.fit)) };
      if (row) {
        const keepOther = row.moments.filter((m) => m.source !== "comments");
        await ctx.db.patch(row._id, {
          ...v,
          moments: v.moments ? [...v.moments, ...keepOther] : row.moments,
          clipFriendly: row.clipFriendly || clipFriendly,
          targetIds: row.targetIds.includes(targetId) ? row.targetIds : [...row.targetIds, targetId],
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("scoutVideos", {
          ...v,
          userId,
          moments: v.moments ?? [],
          clipFriendly,
          status: "new",
          targetIds: [targetId],
          firstSeenAt: now,
          updatedAt: now,
        });
      }
    }
    return null;
  },
});

export const videoById = internalQuery({
  args: { id: v.id("scoutVideos") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

// AI note, taste fit, heatmap moments, competition: patch + rescore.
export const patchVideo = internalMutation({
  args: {
    id: v.id("scoutVideos"),
    aiNote: v.optional(v.string()),
    fit: v.optional(v.number()),
    fitWhy: v.optional(v.string()),
    addMoments: v.optional(v.array(momentV)),
    replaceSource: v.optional(v.string()), // drop existing moments of this source first
    competition: v.optional(v.object({ shorts: v.number(), topViews: v.number(), checkedAt: v.number() })),
    heatmapAt: v.optional(v.number()),
    busy: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, aiNote, fit, fitWhy, addMoments, replaceSource, competition, heatmapAt, busy }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    let moments = row.moments;
    if (replaceSource) moments = moments.filter((m) => m.source !== replaceSource);
    if (addMoments) moments = [...moments, ...addMoments].slice(0, 15);
    await rescore(ctx, row, {
      moments,
      ...(aiNote !== undefined ? { aiNote, analyzedAt: Date.now() } : {}),
      ...(fit !== undefined ? { fit: Math.round(Math.max(0, Math.min(100, fit))), fitWhy } : {}),
      ...(competition ? { competition } : {}),
      ...(heatmapAt ? { heatmapAt } : {}),
      ...(busy !== undefined ? { busy } : {}),
    });
    return null;
  },
});

// New high scorers without an AI note. Each video goes to the AI once
// (a failed call is retried once more, then never again).
export const toAnalyze = internalQuery({
  args: { userId: v.string(), minScore: v.number(), limit: v.number() },
  handler: async (ctx, { userId, minScore, limit }) =>
    (
      await ctx.db
        .query("scoutVideos")
        .withIndex("by_user_score", (q) => q.eq("userId", userId).gte("score", minScore))
        .order("desc")
        .take(80)
    )
      .filter((r) => (r.status === "new" || r.status === "saved") && !r.analyzedAt && !r.rating && (r.aiTries ?? 0) < 2)
      .slice(0, limit),
});

export const countAiTry = internalMutation({
  args: { id: v.id("scoutVideos") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row) await ctx.db.patch(id, { aiTries: (row.aiTries ?? 0) + 1 });
    return null;
  },
});
