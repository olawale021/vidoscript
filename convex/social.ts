import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { r2, SIX_HOURS } from "./r2";

// Social posting & tracking with each platform's own API (no middleman).
// Network calls and tokens live in socialNode.ts; this file is the data side.
// Platforms send the browser back to the Convex HTTP route
// /social/callback/<platform> (convex/http.ts), which finishes the connect.

export type Platform = "instagram" | "youtube" | "tiktok";
export const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok"];
const platformV = v.union(v.literal("instagram"), v.literal("youtube"), v.literal("tiktok"));

// Which platforms are set up on this deployment (app id/secret present).
function configured(p: Platform) {
  if (p === "instagram") {
    return !!(
      (process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.INSTAGRAM_CONFIG_ID) ||
      (process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET)
    );
  }
  if (p === "youtube") return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

export const FB_VERSION = "v27.0"; // Meta's Unified Login docs use v27.0
export const redirectUri = (p: Platform) => `${process.env.CONVEX_SITE_URL}/social/callback/${p}`;

async function requireUser(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

const randomState = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

// Only send the browser back to our own app.
function safeOrigin(origin: string) {
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname.endsWith("vidoscript.app")) return u.origin;
  } catch {
    // fall through
  }
  return "https://app.vidoscript.app";
}

// ── Accounts ──

export const accounts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db
      .query("socialAccounts")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    return {
      accounts: rows.map(({ accessTokenEnc: _a, refreshTokenEnc: _r, ...safe }) => safe),
      configured: Object.fromEntries(PLATFORMS.map((p) => [p, configured(p)])) as Record<Platform, boolean>,
    };
  },
});

// Start connecting: returns the platform's sign-in URL to open.
export const startConnect = mutation({
  args: { platform: platformV, origin: v.string() },
  handler: async (ctx, { platform, origin }) => {
    const userId = await requireUser(ctx);
    if (!configured(platform)) throw new Error(`${platform} isn't set up on this server yet.`);
    if (!process.env.CONVEX_SITE_URL) throw new Error("CONVEX_SITE_URL is missing");
    const state = randomState();
    await ctx.db.insert("socialConnects", { state, userId, platform, returnTo: safeOrigin(origin), createdAt: Date.now() });
    if (platform === "instagram" && process.env.INSTAGRAM_CONFIG_ID) {
      // Unified login (new Meta apps): Facebook Login for Business with a
      // configuration that grants an Instagram account (system-user token).
      const q = new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        redirect_uri: redirectUri("instagram"),
        config_id: process.env.INSTAGRAM_CONFIG_ID,
        response_type: "code",
        override_default_response_type: "true",
        state,
      });
      return `https://www.facebook.com/dialog/oauth?${q}`;
    }
    if (platform === "instagram") {
      const q = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        redirect_uri: redirectUri("instagram"),
        response_type: "code",
        scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        state,
      });
      return `https://www.instagram.com/oauth/authorize?${q}`;
    }
    if (platform === "youtube") {
      const q = new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        redirect_uri: redirectUri("youtube"),
        response_type: "code",
        scope: [
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/yt-analytics.readonly",
        ].join(" "),
        access_type: "offline", // refresh token
        prompt: "consent", // always return a refresh token
        include_granted_scopes: "true",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    }
    if (platform === "tiktok") {
      const q = new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        redirect_uri: redirectUri("tiktok"),
        response_type: "code",
        // video.list (stats) is optional: drop it via TIKTOK_SCOPES if the app doesn't have it yet.
        scope: process.env.TIKTOK_SCOPES?.trim() || "user.info.basic,user.info.stats,video.publish,video.list",
        state,
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
    }
    throw new Error(`Connecting ${platform} is coming next.`);
  },
});

export const disconnect = mutation({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx, { accountId }) => {
    const userId = await requireUser(ctx);
    const acc = await ctx.db.get(accountId);
    if (!acc || acc.userId !== userId) throw new Error("Not found");
    // Posts stay (with their stats) but can't be refreshed any more.
    const media = await ctx.db.query("socialMedia").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect();
    for (const m of media) await ctx.db.delete(m._id);
    await ctx.db.delete(accountId);
    return null;
  },
});

// ── Posting ──

// What can be posted from a story or clip (its finished MP4 + suggested copy).
async function sourceInfo(ctx: QueryCtx, userId: string, sourceType: "story" | "clip", sourceId: string) {
  if (sourceType === "story") {
    const s = await ctx.db.get(sourceId as Id<"stories">);
    if (!s || s.userId !== userId) return null;
    return { key: s.outputKey ?? null, title: s.title, caption: [s.hook, s.title].filter(Boolean).join("\n\n") };
  }
  const c = await ctx.db.get(sourceId as Id<"clips">);
  if (!c || c.userId !== userId) return null;
  const tags = (c.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return { key: c.outputKey ?? null, title: c.title, caption: [c.postCaption ?? c.hook, tags].filter(Boolean).join("\n\n") };
}

// Defaults for the Post dialog.
export const draft = query({
  args: { sourceType: v.union(v.literal("story"), v.literal("clip")), sourceId: v.string() },
  handler: async (ctx, { sourceType, sourceId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const info = await sourceInfo(ctx, identity.subject, sourceType, sourceId);
    if (!info) return null;
    const posts = await ctx.db
      .query("socialPosts")
      .withIndex("by_source", (q) => q.eq("sourceType", sourceType).eq("sourceId", sourceId))
      .collect();
    return { ready: !!info.key, title: info.title, caption: info.caption, posts: posts.filter((p) => p.userId === identity.subject) };
  },
});

export const createPosts = mutation({
  args: {
    sourceType: v.union(v.literal("story"), v.literal("clip")),
    sourceId: v.string(),
    targets: v.array(
      v.object({
        accountId: v.id("socialAccounts"),
        title: v.string(),
        caption: v.string(),
        privacy: v.optional(v.string()),
        aiLabel: v.optional(v.boolean()),
        tiktok: v.optional(
          v.object({
            disableComment: v.boolean(),
            disableDuet: v.boolean(),
            disableStitch: v.boolean(),
            brandOrganic: v.boolean(),
            brandContent: v.boolean(),
          })
        ),
      })
    ),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, { sourceType, sourceId, targets, scheduledAt }) => {
    const userId = await requireUser(ctx);
    const info = await sourceInfo(ctx, userId, sourceType, sourceId);
    if (!info) throw new Error("Not found");
    if (!info.key) throw new Error("Export the video first, then post it.");
    if (targets.length === 0) throw new Error("Pick at least one account.");
    const now = Date.now();
    const later = scheduledAt && scheduledAt > now + 60_000 ? scheduledAt : undefined;
    const ids: Id<"socialPosts">[] = [];
    for (const t of targets) {
      const acc = await ctx.db.get(t.accountId);
      if (!acc || acc.userId !== userId) throw new Error("Account not found");
      if (acc.status !== "active") throw new Error(`Reconnect @${acc.handle} first.`);
      const caption = t.caption.trim().slice(0, acc.platform === "instagram" ? 2200 : 5000);
      if (acc.platform === "youtube" && /[<>]/.test(t.title)) throw new Error("YouTube titles can't contain < or >.");
      if (acc.platform === "youtube" && t.privacy && !["public", "unlisted", "private"].includes(t.privacy)) throw new Error("Bad privacy");
      if (acc.platform === "tiktok") {
        // TikTok's rules: the creator picks the privacy every time (no default).
        if (!t.privacy || !["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].includes(t.privacy)) {
          throw new Error("Choose who can see the TikTok post.");
        }
        if (t.tiktok?.brandContent && t.privacy === "SELF_ONLY") throw new Error("Branded content can't be private on TikTok.");
      }
      if (acc.platform === "instagram" && (caption.match(/#/g) ?? []).length > 30) throw new Error("Instagram allows up to 30 hashtags.");
      const id = await ctx.db.insert("socialPosts", {
        userId,
        accountId: acc._id,
        platform: acc.platform,
        sourceType,
        sourceId,
        title: (t.title.trim() || info.title).slice(0, 100),
        caption,
        privacy: t.privacy,
        aiLabel: t.aiLabel,
        ...(acc.platform === "tiktok" && t.tiktok ? { tiktok: t.tiktok } : {}),
        scheduledAt: later,
        status: later ? "scheduled" : "queued",
        createdAt: now,
      });
      ids.push(id);
      if (!later) await ctx.scheduler.runAfter(0, internal.socialNode.publish, { postId: id });
    }
    return ids;
  },
});

export const cancelPost = mutation({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const userId = await requireUser(ctx);
    const p = await ctx.db.get(postId);
    if (!p || p.userId !== userId) throw new Error("Not found");
    if (p.status === "scheduled" || p.status === "failed") await ctx.db.delete(postId);
    else throw new Error("This post is already going out.");
    return null;
  },
});

export const retryPost = mutation({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const userId = await requireUser(ctx);
    const p = await ctx.db.get(postId);
    if (!p || p.userId !== userId) throw new Error("Not found");
    if (p.status !== "failed") return null;
    await ctx.db.patch(postId, { status: "queued", error: null, step: undefined, containerId: undefined });
    await ctx.scheduler.runAfter(0, internal.socialNode.publish, { postId });
    return null;
  },
});

// ── Posts page ──

export const posts = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const rows = await ctx.db
      .query("socialPosts")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(200);
    const accounts = new Map<string, Doc<"socialAccounts"> | null>();
    const out = [];
    for (const p of rows) {
      if (!accounts.has(p.accountId)) accounts.set(p.accountId, await ctx.db.get(p.accountId));
      const acc = accounts.get(p.accountId);
      out.push({ ...p, handle: acc?.handle ?? "disconnected", avatarUrl: acc?.avatarUrl ?? null });
    }
    return out;
  },
});

export const history = query({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const p = await ctx.db.get(postId);
    if (!identity || !p || p.userId !== identity.subject) return [];
    return await ctx.db.query("socialStats").withIndex("by_post", (q) => q.eq("postId", postId)).collect();
  },
});

// ── Internal (socialNode.ts / http.ts) ──

export const takeConnect = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db.query("socialConnects").withIndex("by_state", (q) => q.eq("state", state)).first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.createdAt < Date.now() - 10 * 60_000) return null;
    return row;
  },
});

export const saveAccount = internalMutation({
  args: {
    userId: v.string(),
    platform: platformV,
    externalId: v.string(),
    handle: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
    via: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("socialAccounts")
      .withIndex("by_external", (q) => q.eq("platform", a.platform).eq("externalId", a.externalId))
      .collect();
    const mine = existing.find((e) => e.userId === a.userId);
    if (mine) {
      await ctx.db.patch(mine._id, { ...a, status: "active", lastError: null, updatedAt: now });
      return mine._id;
    }
    return await ctx.db.insert("socialAccounts", { ...a, status: "active", lastError: null, connectedAt: now, updatedAt: now });
  },
});

export const accountById = internalQuery({
  args: { id: v.id("socialAccounts") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const patchAccount = internalMutation({
  args: {
    id: v.id("socialAccounts"),
    accessTokenEnc: v.optional(v.string()),
    refreshTokenEnc: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("expired"), v.literal("revoked"))),
    lastError: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

// Accounts whose token expires within `withinMs` (for refresh).
export const expiringAccounts = internalQuery({
  args: { withinMs: v.number() },
  handler: async (ctx, { withinMs }) =>
    (
      await ctx.db
        .query("socialAccounts")
        .withIndex("by_expiry", (q) => q.eq("status", "active").lt("tokenExpiresAt", Date.now() + withinMs))
        .take(500)
    )
      // Instagram-login tokens (60 days) only. YouTube/TikTok refresh on demand;
      // Unified-login (system-user) tokens don't expire.
      .filter((a) => a.platform === "instagram" && a.via !== "facebook" && a.tokenExpiresAt != null)
      .slice(0, 50),
});

// Everything publish() needs: the post, its account, and a fresh video URL.
export const publishInfo = internalQuery({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const account = await ctx.db.get(post.accountId);
    const info = await sourceInfo(ctx, post.userId, post.sourceType, post.sourceId);
    const videoUrl = info?.key ? await r2.getUrl(info.key, { expiresIn: SIX_HOURS }) : null;
    return { post, account, videoUrl };
  },
});

export const patchPost = internalMutation({
  args: {
    id: v.id("socialPosts"),
    status: v.optional(v.union(v.literal("queued"), v.literal("posting"), v.literal("published"), v.literal("failed"))),
    step: v.optional(v.string()),
    containerId: v.optional(v.string()),
    platformPostId: v.optional(v.string()),
    url: v.optional(v.string()),
    error: v.optional(v.union(v.string(), v.null())),
    publishedAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, patch);
    return null;
  },
});

// Scheduled posts that are due now.
export const duePosts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("socialPosts")
      .withIndex("by_status", (q) => q.eq("status", "scheduled").lte("scheduledAt", Date.now()))
      .take(20);
    for (const p of due) await ctx.db.patch(p._id, { status: "queued" });
    return due.map((p) => p._id);
  },
});

// Published posts whose stats are due: hourly for 2 days, then daily for 30 days.
export const statsDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("socialPosts")
      .withIndex("by_stats", (q) => q.eq("status", "published").lt("statsAt", now - 55 * 60_000))
      .take(200); // includes never-checked posts (statsAt unset sorts first)
    return rows
      .filter((p) => {
        const age = now - (p.publishedAt ?? p.createdAt);
        if (age > 30 * 86_400_000) return false;
        if (age > 2 * 86_400_000) return !p.statsAt || now - p.statsAt > 23 * 3_600_000;
        return true;
      })
      .slice(0, 60);
  },
});

export const saveStats = internalMutation({
  args: {
    postId: v.id("socialPosts"),
    stats: v.object({
      views: v.optional(v.number()),
      likes: v.optional(v.number()),
      comments: v.optional(v.number()),
      shares: v.optional(v.number()),
      saves: v.optional(v.number()),
      reach: v.optional(v.number()),
      avgWatchSec: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { postId, stats }) => {
    const now = Date.now();
    if (!(await ctx.db.get(postId))) return null;
    await ctx.db.patch(postId, { stats, statsAt: now });
    await ctx.db.insert("socialStats", { postId, at: now, ...stats });
    return null;
  },
});

// ── Socials page: connected accounts + their recent videos ──

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const accounts = await ctx.db
      .query("socialAccounts")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const posted = await ctx.db
      .query("socialPosts")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(500);
    const fromApp = new Set(posted.filter((p) => p.platformPostId).map((p) => `${p.accountId}:${p.platformPostId}`));
    const out = [];
    for (const a of accounts) {
      const { accessTokenEnc: _a, refreshTokenEnc: _r, ...safe } = a;
      const media = await ctx.db
        .query("socialMedia")
        .withIndex("by_account", (q) => q.eq("accountId", a._id))
        .order("desc")
        .take(30);
      out.push({ ...safe, media: media.map((m) => ({ ...m, fromApp: fromApp.has(`${a._id}:${m.externalId}`) })) });
    }
    return out;
  },
});

export const accountForSync = internalQuery({
  args: { accountId: v.id("socialAccounts"), userId: v.optional(v.string()) },
  handler: async (ctx, { accountId, userId }) => {
    const a = await ctx.db.get(accountId);
    if (!a || (userId && a.userId !== userId)) return null;
    return a;
  },
});

const mediaV = v.object({
  externalId: v.string(),
  title: v.string(),
  thumbnailUrl: v.optional(v.string()),
  url: v.optional(v.string()),
  publishedAt: v.number(),
  durationSec: v.optional(v.number()),
  kind: v.optional(v.string()),
  views: v.optional(v.number()),
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
  shares: v.optional(v.number()),
});

export const saveSync = internalMutation({
  args: {
    accountId: v.id("socialAccounts"),
    profile: v.optional(
      v.object({
        followers: v.optional(v.number()),
        following: v.optional(v.number()),
        videoCount: v.optional(v.number()),
        totalViews: v.optional(v.number()),
        totalLikes: v.optional(v.number()),
      })
    ),
    avatarUrl: v.optional(v.string()),
    media: v.array(mediaV),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, profile, avatarUrl, media, error }) => {
    const a = await ctx.db.get(accountId);
    if (!a) return null;
    const now = Date.now();
    await ctx.db.patch(accountId, {
      ...(profile ? { profile } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      syncedAt: now,
      syncError: error ?? null,
    });
    for (const m of media) {
      const row = await ctx.db
        .query("socialMedia")
        .withIndex("by_external", (q) => q.eq("accountId", accountId).eq("externalId", m.externalId))
        .first();
      if (row) await ctx.db.patch(row._id, { ...m, updatedAt: now });
      else await ctx.db.insert("socialMedia", { ...m, accountId, userId: a.userId, platform: a.platform, updatedAt: now });
    }
    return null;
  },
});

export const myAccountsFull = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => ({
    accounts: await ctx.db
      .query("socialAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  }),
});
