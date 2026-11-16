import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  getUserProfile,
  getUserFeed,
  MAX_RESULTS,
  type InstagramPost,
  type InstagramFeed,
  type InstagramProfile,
} from "@/lib/instagram";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// IG CDN URLs are signed and expire — treat cached data older than this as
// stale so images keep working. One refresh per creator per day, max.
const CACHE_STALE_MS = 24 * 60 * 60 * 1000;

// Apify takes a username, not a numeric user id: resolve it from the cached
// profile (every feed is opened from a profile, so it is always cached first).
async function fetchFeedPages(
  userId: string,
  cursor?: string
): Promise<{ items: InstagramPost[]; more_available: boolean; next_max_id?: string }> {
  const user = (await convex.query(api.instagram.getUserByUserId, { userId })) as IgUserDoc | null;
  if (!user) throw new Error("Open this creator's profile first, then load their posts");
  const feed = await getUserFeed(user.username, cursor);
  return { items: feed.items ?? [], more_available: feed.more_available, next_max_id: feed.next_max_id };
}

export interface FavoriteCreator extends InstagramProfile {
  added_at: string;
  cached_post_count: number;
}

interface IgUserDoc {
  username: string;
  userId: string;
  fullName?: string;
  isPrivate: boolean;
  profilePicUrl?: string;
  isVerified: boolean;
  biography?: string;
  followerCount: number;
  followingCount: number;
  mediaCount: number;
  category: string | null;
  externalUrl: string | null;
  hdProfilePicUrl: string | null;
  cachedAt?: number;
}

function toProfile(u: IgUserDoc): InstagramProfile {
  return {
    pk: Number(u.userId),
    username: u.username,
    full_name: u.fullName || "",
    is_private: u.isPrivate,
    profile_pic_url: u.profilePicUrl || "",
    is_verified: u.isVerified,
    biography: u.biography || "",
    follower_count: u.followerCount || 0,
    following_count: u.followingCount || 0,
    media_count: u.mediaCount || 0,
    category: u.category || null,
    external_url: u.externalUrl || null,
    hd_profile_pic_url_info: u.hdProfilePicUrl
      ? { url: u.hdProfilePicUrl, width: 0, height: 0 }
      : undefined,
  };
}

function mapPostForCache(uid: string) {
  return (post: InstagramPost) => ({
    postId: post.id,
    pk: String(post.pk),
    userId: uid,
    mediaType: post.media_type,
    takenAt: post.taken_at,
    captionText: post.caption?.text ?? null,
    likeCount: post.like_count ?? 0,
    commentCount: post.comment_count ?? 0,
    data: JSON.parse(JSON.stringify(post)),
  });
}

export async function getCachedProfile(username: string): Promise<InstagramProfile> {
  const lower = username.toLowerCase();

  const row = (await convex.query(api.instagram.getUserByUsername, {
    username: lower,
  })) as IgUserDoc | null;

  // Treat as stale if key profile fields are missing (e.g. migrated from old
  // cache) or the row is old enough that its signed image URLs have expired.
  const hasProfileData =
    row &&
    ((row.followerCount || 0) > 0 ||
      (row.mediaCount || 0) > 0 ||
      (row.biography && row.biography.length > 0));
  const isFresh = row && Date.now() - (row.cachedAt ?? 0) < CACHE_STALE_MS;

  if (hasProfileData && isFresh && row) {
    console.log(`[Cache] HIT igUsers profile for @${lower}`);
    return toProfile(row);
  }

  console.log(`[Cache] MISS igUsers for @${lower}, calling profile API...`);
  const profile = await getUserProfile(lower);

  await convex.mutation(api.instagram.upsertUser, {
    username: lower,
    userId: String(profile.pk),
    fullName: profile.full_name || undefined,
    isPrivate: profile.is_private,
    profilePicUrl: profile.profile_pic_url || undefined,
    isVerified: profile.is_verified,
    biography: profile.biography || undefined,
    followerCount: profile.follower_count || 0,
    followingCount: profile.following_count || 0,
    mediaCount: profile.media_count || 0,
    category: profile.category || null,
    externalUrl: profile.external_url || null,
    hdProfilePicUrl: profile.hd_profile_pic_url_info?.url || null,
  });

  return profile;
}

export async function getCachedUserFeed(
  userId: string,
  options: { forceRefresh?: boolean; nextMaxId?: string } = {}
): Promise<InstagramFeed> {
  const uid = String(userId);
  const { forceRefresh = false, nextMaxId } = options;

  // If paginating, always call API for the new page(s)
  if (nextMaxId) {
    console.log(`[Cache] Paginating igPosts for user ${uid}, max_id=${nextMaxId}`);
    const feed = await fetchFeedPages(userId, nextMaxId);

    if (feed.items?.length) {
      await convex.mutation(api.instagram.upsertPosts, {
        posts: feed.items.map(mapPostForCache(uid)),
      });
      console.log(`[Cache] Upserted ${feed.items.length} paginated posts for user ${uid}`);
    }

    const items = (await convex.query(api.instagram.getPostsByUser, {
      userId: uid,
    })) as InstagramPost[];

    return {
      items,
      num_results: items.length,
      more_available: feed.more_available ?? false,
      next_max_id: feed.next_max_id,
      status: "ok",
    };
  }

  // Non-paginated: check cache first. Serve it only while fresh — stale rows
  // carry expired signed CDN URLs (broken thumbnails), so fall through to the
  // API, which overwrites the cache with working URLs.
  if (!forceRefresh) {
    const meta = (await convex.query(api.instagram.getFeedCacheMeta, {
      userId: uid,
    })) as {
      count: number;
      newestCachedAt: number;
      oldestPostId: string | null;
      mediaCount: number | null;
    };

    if (meta.count > 0 && Date.now() - meta.newestCachedAt < CACHE_STALE_MS) {
      const cached = (await convex.query(api.instagram.getPostsByUser, {
        userId: uid,
      })) as InstagramPost[];
      console.log(`[Cache] HIT igPosts for user ${uid}: ${cached.length} posts`);
      // Keep "Load more" working on cache hits: the cursor is the number of
      // posts already cached (see lib/instagram.ts).
      const hasMore = (meta.mediaCount ? meta.count < meta.mediaCount : true) && meta.count < MAX_RESULTS;
      return {
        items: cached,
        num_results: cached.length,
        more_available: hasMore,
        next_max_id: hasMore ? String(meta.count) : undefined,
        status: "ok",
      };
    }
    if (meta.count > 0) {
      console.log(`[Cache] STALE igPosts for user ${uid}, refreshing from API...`);
    }
  }

  console.log(
    `[Cache] ${forceRefresh ? "REFRESH" : "MISS"} igPosts for user ${uid}, calling API...`
  );
  const feed = await fetchFeedPages(userId);

  if (feed.items?.length) {
    await convex.mutation(api.instagram.upsertPosts, {
      posts: feed.items.map(mapPostForCache(uid)),
    });
    console.log(`[Cache] Upserted ${feed.items.length} posts for user ${uid}`);

    // Heal the cached avatar too — post data carries a fresh profile pic URL.
    const freshPic = feed.items[0]?.user?.profile_pic_url;
    if (freshPic) {
      await convex.mutation(api.instagram.patchUserPic, {
        userId: uid,
        profilePicUrl: freshPic,
      });
    }
  }

  const all = (await convex.query(api.instagram.getPostsByUser, {
    userId: uid,
  })) as InstagramPost[];

  return {
    items: all,
    num_results: all.length,
    more_available: feed.more_available ?? false,
    next_max_id: feed.next_max_id,
    status: "ok",
  };
}

// ── Favorite Creators ──

export async function toggleFavorite(username: string): Promise<boolean> {
  const result = await convex.mutation(api.instagram.toggleFavorite, {
    username: username.toLowerCase(),
  });
  console.log(`[Favorites] ${result ? "Added" : "Removed"} @${username.toLowerCase()}`);
  return result;
}

export async function isFavorite(username: string): Promise<boolean> {
  return await convex.query(api.instagram.isFavorite, {
    username: username.toLowerCase(),
  });
}

export async function getFavoriteCreators(): Promise<FavoriteCreator[]> {
  const rows = (await convex.query(api.instagram.listFavorites, {})) as {
    user: IgUserDoc;
    addedAt: number;
    cachedPostCount: number;
  }[];

  return rows.map((r) => ({
    ...toProfile(r.user),
    added_at: new Date(r.addedAt).toISOString(),
    cached_post_count: r.cachedPostCount,
  }));
}

export async function getTopPostsAcrossFavorites(
  limit = 50
): Promise<(InstagramPost & { _engagementScore: number })[]> {
  const rows = (await convex.query(api.instagram.topPostsAcrossFavorites, {
    limit,
  })) as { data: InstagramPost; score: number }[];

  return rows.map((r) => ({
    ...r.data,
    _engagementScore: r.score,
  }));
}
