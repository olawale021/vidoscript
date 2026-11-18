import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { r2, SIX_HOURS } from "./r2";
import { enqueue } from "./stories";
import type { StoryBible } from "../types/story";

// Phase 3a: a series is a saved cast (characters + locations with reference
// images) and style. New episodes start with it, so characters look the same
// in every episode and their pictures don't need drawing again.

async function requireUser(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

async function episodesOf(ctx: QueryCtx, userId: string, seriesId: Id<"series">) {
  const stories = await ctx.db.query("stories").withIndex("by_user", (q) => q.eq("userId", userId)).take(500);
  return stories.filter((s) => s.seriesId === seriesId);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const all = await ctx.db
      .query("series")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(50);
    const stories = await ctx.db.query("stories").withIndex("by_user", (q) => q.eq("userId", identity.subject)).take(500);
    return await Promise.all(
      all.map(async (s) => {
        const bible = s.bible as StoryBible;
        return {
          _id: s._id,
          title: s.title,
          style: s.style,
          aspect: s.aspect,
          episodes: stories.filter((x) => x.seriesId === s._id).length,
          cast: await Promise.all(
            bible.characters.slice(0, 5).map(async (c) => ({
              id: c.id,
              name: c.name,
              url: c.refKey ? await r2.getUrl(c.refKey, { expiresIn: SIX_HOURS }) : null,
            }))
          ),
          locations: bible.locations.length,
        };
      })
    );
  },
});

// Start the next episode: same style, voice and cast (reference images reused).
export const newEpisode = mutation({
  args: { seriesId: v.id("series"), idea: v.string(), targetSec: v.optional(v.number()) },
  handler: async (ctx, { seriesId, idea, targetSec }) => {
    const userId = await requireUser(ctx);
    const series = await ctx.db.get(seriesId);
    if (!series || series.userId !== userId) throw new Error("Not found");
    const text = idea.trim().slice(0, 4000);
    if (text.length < 5) throw new Error("Describe this episode in a sentence or two.");
    const now = Date.now();
    const id = await ctx.db.insert("stories", {
      userId,
      title: text.length > 60 ? `${text.slice(0, 57)}…` : text,
      idea: text,
      aspect: series.aspect,
      targetSec: Math.max(15, Math.min(300, Math.round(targetSec ?? 60))),
      style: series.style,
      styleNotes: series.styleNotes,
      narratorVoice: series.narratorVoice,
      step: "script",
      bible: series.bible,
      seriesId,
      captionStyle: "bold",
      costUsd: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(seriesId, { updatedAt: now });
    await enqueue(ctx, (await ctx.db.get(id))!, "script");
    return id;
  },
});

export const rename = mutation({
  args: { seriesId: v.id("series"), title: v.string() },
  handler: async (ctx, { seriesId, title }) => {
    const userId = await requireUser(ctx);
    const series = await ctx.db.get(seriesId);
    if (!series || series.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(seriesId, { title: title.trim().slice(0, 120) || series.title, updatedAt: Date.now() });
    return null;
  },
});

// Deleting a series keeps its episodes. Its reference images are deleted only
// when no episode still uses them.
export const remove = mutation({
  args: { seriesId: v.id("series") },
  handler: async (ctx, { seriesId }) => {
    const userId = await requireUser(ctx);
    const series = await ctx.db.get(seriesId);
    if (!series || series.userId !== userId) throw new Error("Not found");
    const episodes = await episodesOf(ctx, userId, seriesId);
    if (episodes.length === 0) {
      const bible = series.bible as StoryBible;
      for (const x of [...bible.characters, ...bible.locations]) if (x.refKey) await r2.deleteObject(ctx, x.refKey).catch(() => {});
    }
    for (const e of episodes) await ctx.db.patch(e._id, { seriesId: undefined });
    await ctx.db.delete(seriesId);
    return null;
  },
});

// ── Used by seriesNode.saveFromStory ──

export const storyForSeries = internalQuery({
  args: { storyId: v.id("stories"), userId: v.string() },
  handler: async (ctx, { storyId, userId }) => {
    const story = await ctx.db.get(storyId);
    if (!story || story.userId !== userId) return null;
    return story;
  },
});

export const insertSeries = internalMutation({
  args: {
    storyId: v.id("stories"),
    userId: v.string(),
    title: v.string(),
    bible: v.any(),
  },
  handler: async (ctx, { storyId, userId, title, bible }) => {
    const story = await ctx.db.get(storyId);
    if (!story || story.userId !== userId) throw new Error("Not found");
    const now = Date.now();
    const id = await ctx.db.insert("series", {
      userId,
      title,
      style: story.style,
      styleNotes: story.styleNotes,
      aspect: story.aspect,
      narratorVoice: story.narratorVoice,
      bible,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(storyId, { seriesId: id, updatedAt: now });
    return id;
  },
});
