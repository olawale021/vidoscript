import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

// ── Media library ──
// A library item is a saved video (imported from Instagram or uploaded) the
// user can later turn into projects. Imports run in a background action:
// the row is inserted as "importing" and patched to "ready"/"failed" when the
// download lands, so the UI updates reactively with no polling.

// Reactive list of the current user's library, newest first.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(200);

    return await Promise.all(
      items.map(async (item) => ({
        id: item._id,
        source: item.source,
        sourceUrl: item.sourceUrl ?? null,
        shortcode: item.shortcode ?? null,
        creatorHandle: item.creatorHandle ?? null,
        caption: item.caption ?? null,
        durationSec: item.durationSec ?? null,
        fileSizeBytes: item.fileSizeBytes ?? null,
        status: item.status,
        error: item.error ?? null,
        videoUrl: item.storageId ? await ctx.storage.getUrl(item.storageId) : null,
        thumbnailUrl: item.thumbnailStorageId
          ? await ctx.storage.getUrl(item.thumbnailStorageId)
          : null,
        createdAt: item._creationTime,
      }))
    );
  },
});

// Kick off an Instagram import. Two entry points share this:
//  - paste-URL: only a shortcode is known; the action resolves it via RapidAPI
//  - in-app Instagram browser: the cached post JSON supplies a fresh CDN
//    videoUrl + metadata, so no RapidAPI call is needed
// Dedup: one item per (user, shortcode) — re-saving jumps to the existing item.
export const startInstagramImport = mutation({
  args: {
    shortcode: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    creatorHandle: v.optional(v.string()),
    caption: v.optional(v.string()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!args.shortcode && !args.videoUrl) {
      throw new Error("Provide an Instagram link or video URL");
    }

    if (args.shortcode) {
      const existing = await ctx.db
        .query("libraryItems")
        .withIndex("by_user_shortcode", (q) =>
          q.eq("userId", identity.subject).eq("shortcode", args.shortcode)
        )
        .first();
      if (existing) {
        // Failed imports get retried in place instead of duplicated.
        if (existing.status === "failed") {
          await ctx.db.patch(existing._id, { status: "importing", error: null });
          await ctx.scheduler.runAfter(0, internal.libraryActions.importInstagramVideo, {
            itemId: existing._id,
            shortcode: args.shortcode,
            videoUrl: args.videoUrl,
            thumbnailUrl: args.thumbnailUrl,
          });
          return { id: existing._id, existing: false };
        }
        return { id: existing._id, existing: true };
      }
    }

    const id = await ctx.db.insert("libraryItems", {
      userId: identity.subject,
      source: "instagram",
      sourceUrl:
        args.sourceUrl ??
        (args.shortcode ? `https://www.instagram.com/reel/${args.shortcode}/` : undefined),
      shortcode: args.shortcode,
      creatorHandle: args.creatorHandle,
      caption: args.caption,
      durationSec: args.durationSec,
      status: "importing",
      error: null,
    });

    await ctx.scheduler.runAfter(0, internal.libraryActions.importInstagramVideo, {
      itemId: id,
      shortcode: args.shortcode,
      videoUrl: args.videoUrl,
      thumbnailUrl: args.thumbnailUrl,
    });

    return { id, existing: false };
  },
});

// Retry a failed import. Needs a shortcode so the action can resolve a fresh
// CDN URL — Instagram's video URLs are signed and expire quickly.
export const retryImport = mutation({
  args: { id: v.id("libraryItems") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const item = await ctx.db.get(id);
    if (!item || item.userId !== identity.subject) throw new Error("Not found");
    if (item.status !== "failed") return null;
    if (!item.shortcode) {
      throw new Error(
        "Can't retry this one — open the post in Instagram Posts and save it again"
      );
    }
    await ctx.db.patch(id, { status: "importing", error: null });
    await ctx.scheduler.runAfter(0, internal.libraryActions.importInstagramVideo, {
      itemId: id,
      shortcode: item.shortcode,
    });
    return null;
  },
});

// Delete an item. The stored files are only removed when no project still
// references them (projects copy the item's videoStorageId at creation).
export const remove = mutation({
  args: { id: v.id("libraryItems") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const item = await ctx.db.get(id);
    if (!item || item.userId !== identity.subject) return null;

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const referenced = projects.some(
      (p) =>
        p.libraryItemId === id ||
        (item.storageId && p.videoStorageId === item.storageId)
    );

    if (!referenced) {
      if (item.storageId) await ctx.storage.delete(item.storageId);
      if (item.thumbnailStorageId) await ctx.storage.delete(item.thumbnailStorageId);
    }
    await ctx.db.delete(id);
    return null;
  },
});

// Spin up a script project from a ready library item. The project workspace
// auto-runs the transcribe → analyze → generate pipeline for "processing" rows.
export const createProject = mutation({
  args: {
    id: v.id("libraryItems"),
    userPrompt: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, userPrompt }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const item = await ctx.db.get(id);
    if (!item || item.userId !== identity.subject) throw new Error("Not found");
    if (item.status !== "ready" || !item.storageId) {
      throw new Error("This video hasn't finished importing yet");
    }

    const captionStart = item.caption?.trim().split(/\s+/).slice(0, 6).join(" ");
    const title = captionStart
      ? `${captionStart}…`
      : item.creatorHandle
        ? `@${item.creatorHandle} reel`
        : "Library video";

    return await ctx.db.insert("projects", {
      userId: identity.subject,
      title,
      transcript: "",
      segments: [],
      analysis: {},
      script: "",
      chat: [],
      tone: null,
      model: "gemini",
      userPrompt: userPrompt ?? null,
      videoStorageId: item.storageId,
      libraryItemId: id,
      status: "processing",
      progressStep: "transcribing",
      error: null,
      updatedAt: Date.now(),
    });
  },
});

// ── Internal: called by the import action ──

export const markReady = internalMutation({
  args: {
    id: v.id("libraryItems"),
    storageId: v.id("_storage"),
    thumbnailStorageId: v.optional(v.id("_storage")),
    fileSizeBytes: v.optional(v.number()),
    // Metadata discovered during resolution (paste-URL imports start with
    // nothing but a shortcode). Never overwrites values already set.
    creatorHandle: v.optional(v.string()),
    caption: v.optional(v.string()),
    durationSec: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const item = await ctx.db.get(id);
    if (!item) return null;
    const updates: Record<string, unknown> = {
      storageId: fields.storageId,
      status: "ready",
      error: null,
    };
    if (fields.thumbnailStorageId) updates.thumbnailStorageId = fields.thumbnailStorageId;
    if (fields.fileSizeBytes !== undefined) updates.fileSizeBytes = fields.fileSizeBytes;
    if (fields.creatorHandle && !item.creatorHandle) updates.creatorHandle = fields.creatorHandle;
    if (fields.caption && !item.caption) updates.caption = fields.caption;
    if (fields.durationSec !== undefined && item.durationSec === undefined)
      updates.durationSec = fields.durationSec;
    await ctx.db.patch(id, updates);
    return null;
  },
});

export const markFailed = internalMutation({
  args: { id: v.id("libraryItems"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    const item = await ctx.db.get(id);
    if (!item) return null;
    await ctx.db.patch(id, { status: "failed", error });
    return null;
  },
});
