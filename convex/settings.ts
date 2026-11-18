import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { STORY_LENGTHS, VOICE_IDS } from "../types/story";

// Per-user defaults (Settings page) + "reset what the AI learned".
// settings.get always returns a full object: the saved row merged over the
// app's built-in defaults, so callers never have to handle missing fields.

export const SETTINGS_DEFAULTS = {
  defaultNarratorVoice: "onyx",
  defaultStoryAspect: "9:16" as "9:16" | "16:9",
  defaultStoryLength: 60,
  defaultClipAspect: "9:16" as "9:16" | "1:1" | "16:9",
  defaultFraming: "fit" as "fit" | "fill",
  defaultFitBackground: "blur" as "blur" | "black",
  defaultCaptionStyle: "bold" as "bold" | "karaoke" | "clean" | "none",
  defaultDownloadQuality: "720" as "360" | "480" | "720" | "1080",
  discoverWindowDays: 7,
  discoverLanguage: "en" as "en" | "any",
  defaultTextAi: "openai" as "openai" | "gemini",
};
export const DISCOVER_WINDOWS = [7, 30, 90, 365];

const STAGES = ["script", "plan", "still", "motion", "voice", "video"] as const;

async function requireUser(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    // null while auth is still loading (e.g. right after an OAuth redirect).
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) return null;
    const row = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      defaultNarratorVoice: row?.defaultNarratorVoice ?? SETTINGS_DEFAULTS.defaultNarratorVoice,
      defaultStoryAspect: row?.defaultStoryAspect ?? SETTINGS_DEFAULTS.defaultStoryAspect,
      defaultStoryLength: row?.defaultStoryLength ?? SETTINGS_DEFAULTS.defaultStoryLength,
      defaultClipAspect: row?.defaultClipAspect ?? SETTINGS_DEFAULTS.defaultClipAspect,
      defaultFraming: row?.defaultFraming ?? SETTINGS_DEFAULTS.defaultFraming,
      defaultFitBackground: row?.defaultFitBackground ?? SETTINGS_DEFAULTS.defaultFitBackground,
      defaultCaptionStyle: row?.defaultCaptionStyle ?? SETTINGS_DEFAULTS.defaultCaptionStyle,
      defaultDownloadQuality: row?.defaultDownloadQuality ?? SETTINGS_DEFAULTS.defaultDownloadQuality,
      niches: row?.niches ?? [],
      discoverWindowDays: row?.discoverWindowDays ?? SETTINGS_DEFAULTS.discoverWindowDays,
      discoverLanguage: row?.discoverLanguage ?? SETTINGS_DEFAULTS.discoverLanguage,
      defaultTextAi: row?.defaultTextAi ?? SETTINGS_DEFAULTS.defaultTextAi,
      updatedAt: row?.updatedAt ?? null,
    };
  },
});

export const update = mutation({
  args: {
    defaultNarratorVoice: v.optional(v.string()),
    defaultStoryAspect: v.optional(v.union(v.literal("9:16"), v.literal("16:9"))),
    defaultStoryLength: v.optional(v.number()),
    defaultClipAspect: v.optional(v.union(v.literal("9:16"), v.literal("1:1"), v.literal("16:9"))),
    defaultFraming: v.optional(v.union(v.literal("fill"), v.literal("fit"))),
    defaultFitBackground: v.optional(v.union(v.literal("black"), v.literal("blur"))),
    defaultCaptionStyle: v.optional(
      v.union(v.literal("bold"), v.literal("karaoke"), v.literal("clean"), v.literal("none"))
    ),
    defaultDownloadQuality: v.optional(v.union(v.literal("360"), v.literal("480"), v.literal("720"), v.literal("1080"))),
    niches: v.optional(v.array(v.string())),
    discoverWindowDays: v.optional(v.number()),
    discoverLanguage: v.optional(v.union(v.literal("en"), v.literal("any"))),
    defaultTextAi: v.optional(v.union(v.literal("openai"), v.literal("gemini"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (args.defaultNarratorVoice !== undefined && !VOICE_IDS.includes(args.defaultNarratorVoice)) {
      throw new Error("Unknown voice");
    }
    if (args.defaultStoryLength !== undefined && !STORY_LENGTHS.includes(args.defaultStoryLength)) {
      throw new Error("Unsupported story length");
    }
    if (args.discoverWindowDays !== undefined && !DISCOVER_WINDOWS.includes(args.discoverWindowDays)) {
      throw new Error("Unsupported time window");
    }
    if (args.niches !== undefined) {
      const seen = new Set<string>();
      args.niches = args.niches
        .map((n) => n.replace(/\s+/g, " ").trim().slice(0, 40))
        .filter((n) => n.length >= 2 && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
        .slice(0, 12);
    }
    const patch = Object.fromEntries(Object.entries(args).filter(([, val]) => val !== undefined));
    const row = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("userSettings", { userId, ...patch, updatedAt: Date.now() });
    }
  },
});

// What the AI has learned from so far (shown on the Settings page).
export const learningCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = (await ctx.auth.getUserIdentity())?.subject;
    if (!userId) return null;
    const rated = await ctx.db
      .query("clips")
      .withIndex("by_user_rated", (q) => q.eq("userId", userId).gte("ratedAt", 0))
      .take(1000);
    let storyFeedback = 0;
    for (const stage of STAGES) {
      const rows = await ctx.db
        .query("storyFeedback")
        .withIndex("by_user_stage", (q) => q.eq("userId", userId).eq("stage", stage))
        .take(1000);
      storyFeedback += rows.length;
    }
    const scoutRatings = (
      await ctx.db
        .query("scoutVideos")
        .withIndex("by_user_rated", (q) => q.eq("userId", userId).gt("ratedAt", 0))
        .take(1000)
    ).length;
    return { clipRatings: rated.length, storyFeedback, scoutRatings };
  },
});

// Clears clip ratings (hidden clips stay hidden) and deletes story feedback.
// Works in batches; the caller repeats until `done` is true.
const BATCH = 500;
export const resetLearning = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rated = await ctx.db
      .query("clips")
      .withIndex("by_user_rated", (q) => q.eq("userId", userId).gte("ratedAt", 0))
      .take(BATCH);
    for (const c of rated) {
      await ctx.db.patch(c._id, {
        rating: undefined,
        ratingReasons: undefined,
        ratingNote: undefined,
        ratedAt: undefined,
      });
    }
    // Discover ratings (scores pick up the change on the next scan).
    const scout = await ctx.db
      .query("scoutVideos")
      .withIndex("by_user_rated", (q) => q.eq("userId", userId).gt("ratedAt", 0))
      .take(BATCH);
    for (const r of scout) {
      await ctx.db.patch(r._id, { rating: undefined, ratingReasons: undefined, ratingNote: undefined, ratedAt: undefined, fit: undefined, fitWhy: undefined });
    }
    let feedback = 0;
    let budget = BATCH;
    for (const stage of STAGES) {
      if (budget <= 0) break;
      const rows = await ctx.db
        .query("storyFeedback")
        .withIndex("by_user_stage", (q) => q.eq("userId", userId).eq("stage", stage))
        .take(budget);
      for (const r of rows) await ctx.db.delete(r._id);
      feedback += rows.length;
      budget -= rows.length;
    }
    return {
      clipRatings: rated.length,
      storyFeedback: feedback,
      scoutRatings: scout.length,
      done: rated.length < BATCH && scout.length < BATCH && budget > 0,
    };
  },
});
