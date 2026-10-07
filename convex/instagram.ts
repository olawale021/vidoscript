import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ── Users ──

export const getUserByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    return await ctx.db
      .query("igUsers")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
  },
});

export const upsertUser = mutation({
  args: {
    username: v.string(),
    userId: v.string(),
    fullName: v.optional(v.string()),
    isPrivate: v.boolean(),
    profilePicUrl: v.optional(v.string()),
    isVerified: v.boolean(),
    biography: v.optional(v.string()),
    followerCount: v.number(),
    followingCount: v.number(),
    mediaCount: v.number(),
    category: v.union(v.string(), v.null()),
    externalUrl: v.union(v.string(), v.null()),
    hdProfilePicUrl: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("igUsers")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();

    const doc = { ...args, cachedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("igUsers", doc);
    }
    return null;
  },
});

// Refresh just the cached profile picture — IG CDN URLs are signed and
// expire, so feed refreshes heal the avatar with a fresh URL from post data.
export const patchUserPic = mutation({
  args: { userId: v.string(), profilePicUrl: v.string() },
  handler: async (ctx, { userId, profilePicUrl }) => {
    const user = await ctx.db
      .query("igUsers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { profilePicUrl, cachedAt: Date.now() });
    }
    return null;
  },
});

// ── Posts ──

// Cache freshness + pagination cursor for a user's feed, so the cache layer
// can decide staleness and keep "Load More" working on cache hits.
export const getFeedCacheMeta = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const posts = await ctx.db
      .query("igPosts")
      .withIndex("by_user_taken", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    if (posts.length === 0) {
      return { count: 0, newestCachedAt: 0, oldestPostId: null, mediaCount: null };
    }
    const user = await ctx.db
      .query("igUsers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    return {
      count: posts.length,
      newestCachedAt: Math.max(...posts.map((p) => p.cachedAt)),
      oldestPostId: posts[posts.length - 1].postId,
      mediaCount: user?.mediaCount ?? null,
    };
  },
});

export const getPostsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const posts = await ctx.db
      .query("igPosts")
      .withIndex("by_user_taken", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return posts.map((p) => p.data);
  },
});

export const upsertPosts = mutation({
  args: {
    posts: v.array(
      v.object({
        postId: v.string(),
        pk: v.string(),
        userId: v.string(),
        mediaType: v.number(),
        takenAt: v.number(),
        captionText: v.union(v.string(), v.null()),
        likeCount: v.number(),
        commentCount: v.number(),
        data: v.any(),
      })
    ),
  },
  handler: async (ctx, { posts }) => {
    const now = Date.now();
    for (const post of posts) {
      const existing = await ctx.db
        .query("igPosts")
        .withIndex("by_postId", (q) => q.eq("postId", post.postId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          likeCount: post.likeCount,
          commentCount: post.commentCount,
          data: post.data,
          cachedAt: now,
        });
      } else {
        await ctx.db.insert("igPosts", { ...post, cachedAt: now });
      }
    }
    return null;
  },
});

// ── Favorites ──

export const isFavorite = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const fav = await ctx.db
      .query("igFavoriteCreators")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    return fav !== null;
  },
});

export const toggleFavorite = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const existing = await ctx.db
      .query("igFavoriteCreators")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return false;
    }
    await ctx.db.insert("igFavoriteCreators", { username });
    return true;
  },
});

export const listFavorites = query({
  args: {},
  handler: async (ctx) => {
    const favs = await ctx.db.query("igFavoriteCreators").order("desc").collect();
    const result = [];
    for (const fav of favs) {
      const user = await ctx.db
        .query("igUsers")
        .withIndex("by_username", (q) => q.eq("username", fav.username))
        .unique();
      if (!user) continue;
      const posts = await ctx.db
        .query("igPosts")
        .withIndex("by_user_taken", (q) => q.eq("userId", user.userId))
        .collect();
      result.push({ user, addedAt: fav._creationTime, cachedPostCount: posts.length });
    }
    return result;
  },
});

export const topPostsAcrossFavorites = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const favs = await ctx.db.query("igFavoriteCreators").collect();
    const scored: { data: unknown; score: number }[] = [];
    for (const fav of favs) {
      const user = await ctx.db
        .query("igUsers")
        .withIndex("by_username", (q) => q.eq("username", fav.username))
        .unique();
      if (!user) continue;
      const posts = await ctx.db
        .query("igPosts")
        .withIndex("by_user_taken", (q) => q.eq("userId", user.userId))
        .collect();
      for (const p of posts) {
        scored.push({ data: p.data, score: p.likeCount + p.commentCount * 3 });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  },
});
