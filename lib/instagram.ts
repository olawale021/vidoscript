import "server-only";
import type {
  InstagramFeed,
  InstagramPost,
  InstagramProfile,
  InstagramComment,
  InstagramCommentsResponse,
  HashtagFeedResponse,
  CarouselItem,
} from "@/types/instagram";
import { APIFY_ACTORS, runActor } from "@/lib/apify";

export type { InstagramFeed, InstagramPost, InstagramProfile };

// Instagram data via Apify (see lib/apify.ts). Apify has no page cursors, so
// "next page" cursors here are just the number of results already shown:
// the next call asks for that many + PAGE and returns only the new ones.

export const PAGE = 24;
export const MAX_RESULTS = 96;

// ── Apify item shapes (only the fields we use) ──

type ApifyPost = {
  id: string;
  type?: "Image" | "Video" | "Sidecar" | string;
  shortCode?: string;
  caption?: string | null;
  commentsCount?: number;
  likesCount?: number;
  displayUrl?: string;
  videoUrl?: string;
  videoDuration?: number;
  videoPlayCount?: number | null;
  videoViewCount?: number | null;
  dimensionsWidth?: number;
  dimensionsHeight?: number;
  timestamp?: string;
  childPosts?: ApifyPost[];
  ownerUsername?: string;
  ownerFullName?: string;
  ownerId?: string;
  productType?: string;
};

type ApifyProfile = {
  id: string;
  username: string;
  fullName?: string;
  biography?: string;
  externalUrl?: string | null;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  private?: boolean;
  verified?: boolean;
  businessCategoryName?: string | null;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
};

type ApifyComment = {
  id: string;
  text?: string;
  timestamp?: string;
  likesCount?: number;
  ownerUsername?: string;
  ownerProfilePicUrl?: string;
  owner?: { id?: string; username?: string; full_name?: string; profile_pic_url?: string; is_verified?: boolean };
};

// ── Mappers to the app's existing Instagram types ──

const mediaType = (t?: string) => (t === "Video" ? 2 : t === "Sidecar" ? 8 : 1);
const unix = (iso?: string) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

export function toInstagramPost(p: ApifyPost): InstagramPost {
  const w = p.dimensionsWidth ?? 0;
  const h = p.dimensionsHeight ?? 0;
  const children: CarouselItem[] = (p.childPosts ?? []).map((c) => ({
    id: c.id,
    pk: Number(c.id),
    media_type: mediaType(c.type),
    image_versions2: { candidates: c.displayUrl ? [{ url: c.displayUrl, width: c.dimensionsWidth ?? 0, height: c.dimensionsHeight ?? 0 }] : [] },
  }));
  return {
    id: p.id,
    pk: Number(p.id),
    code: p.shortCode,
    media_type: mediaType(p.type),
    taken_at: unix(p.timestamp),
    image_versions2: { candidates: p.displayUrl ? [{ url: p.displayUrl, width: w, height: h }] : [] },
    video_versions: p.videoUrl ? [{ url: p.videoUrl, width: w, height: h }] : undefined,
    carousel_media: children.length ? children : undefined,
    carousel_media_count: children.length || undefined,
    original_width: w || undefined,
    original_height: h || undefined,
    video_duration: p.videoDuration,
    play_count: p.videoPlayCount ?? p.videoViewCount ?? undefined,
    caption: p.caption ? { text: p.caption } : null,
    user: {
      pk: Number(p.ownerId ?? 0),
      username: p.ownerUsername ?? "",
      full_name: p.ownerFullName ?? "",
      is_private: false,
      profile_pic_url: "",
      is_verified: false,
    },
    product_type: p.productType,
    comment_count: p.commentsCount ?? 0,
    // Instagram hides likes on some posts; Apify reports -1 there.
    like_count: Math.max(0, p.likesCount ?? 0),
  };
}

function toProfile(p: ApifyProfile): InstagramProfile {
  return {
    pk: Number(p.id),
    username: p.username,
    full_name: p.fullName ?? "",
    is_private: !!p.private,
    profile_pic_url: p.profilePicUrl ?? "",
    is_verified: !!p.verified,
    media_count: p.postsCount ?? 0,
    follower_count: p.followersCount ?? 0,
    following_count: p.followsCount ?? 0,
    biography: p.biography ?? "",
    external_url: p.externalUrl ?? null,
    category: p.businessCategoryName ?? null,
    hd_profile_pic_url_info: p.profilePicUrlHD ? { url: p.profilePicUrlHD, width: 0, height: 0 } : undefined,
  };
}

function toComment(c: ApifyComment): InstagramComment {
  return {
    pk: c.id,
    text: c.text ?? "",
    created_at: unix(c.timestamp),
    comment_like_count: c.likesCount ?? 0,
    user: {
      pk: Number(c.owner?.id ?? 0),
      username: c.ownerUsername ?? c.owner?.username ?? "",
      full_name: c.owner?.full_name ?? "",
      profile_pic_url: c.ownerProfilePicUrl ?? c.owner?.profile_pic_url ?? "",
      is_verified: !!c.owner?.is_verified,
    },
  };
}

function cursorToCount(cursor?: string | null) {
  const n = Number(cursor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ── Public API (same names the app used with RapidAPI) ──

export async function getUserProfile(username: string): Promise<InstagramProfile> {
  const [p] = await runActor<ApifyProfile>(
    APIFY_ACTORS.profile,
    { usernames: [username] },
    "instagram.profile"
  );
  if (!p) throw new Error(`User "${username}" not found`);
  return toProfile(p);
}

// Latest posts for a username. `cursor` = posts already shown (see PAGE).
export async function getUserFeed(username: string, cursor?: string): Promise<InstagramFeed> {
  const shown = cursorToCount(cursor);
  const limit = Math.min(MAX_RESULTS, shown + PAGE);
  const items = (
    await runActor<ApifyPost>(
      APIFY_ACTORS.scraper,
      {
        directUrls: [`https://www.instagram.com/${encodeURIComponent(username)}/`],
        resultsType: "posts",
        resultsLimit: limit,
        addParentData: false,
      },
      "instagram.feed"
    )
  ).map(toInstagramPost);
  const more = items.length >= limit && limit < MAX_RESULTS;
  return {
    items,
    num_results: items.length,
    more_available: more,
    next_max_id: more ? String(limit) : undefined,
    status: "ok",
  };
}

export async function getPostByShortcode(shortcode: string): Promise<InstagramPost> {
  const [p] = await runActor<ApifyPost>(
    APIFY_ACTORS.post,
    { username: [`https://www.instagram.com/p/${encodeURIComponent(shortcode)}/`], resultsLimit: 1 },
    "instagram.post"
  );
  if (!p) throw new Error("Post not found — it may be private or deleted");
  return toInstagramPost(p);
}

// `section` is kept for the existing UI; Apify returns the hashtag's posts
// in its own order (it can't switch between "recent" and "top").
export async function getHashtagFeed(
  tag: string,
  _section: string = "recent",
  cursor?: string | null
): Promise<HashtagFeedResponse & { rank_token?: string; next_page?: number }> {
  const shown = cursorToCount(cursor);
  const limit = Math.min(MAX_RESULTS, shown + PAGE);
  const all = (
    await runActor<ApifyPost>(
      APIFY_ACTORS.hashtag,
      { hashtags: [tag.replace(/^#/, "")], resultsType: "posts", resultsLimit: limit },
      "instagram.hashtag"
    )
  ).map(toInstagramPost);
  const fresh = all.slice(shown);
  const more = all.length >= limit && limit < MAX_RESULTS;
  return {
    sections: [{ layout_content: { medias: fresh.map((media) => ({ media })) } }],
    next_max_id: more ? String(limit) : undefined,
    next_page: more ? Math.floor(limit / PAGE) + 1 : undefined,
    rank_token: more ? "apify" : undefined,
    more_available: more,
    status: "ok",
  };
}

// Comments for a post by shortcode. `cursor` = comments already shown.
export async function getMediaComments(
  shortcode: string,
  cursor?: string
): Promise<InstagramCommentsResponse> {
  const shown = cursorToCount(cursor);
  const limit = Math.min(MAX_RESULTS, shown + PAGE);
  const all = (
    await runActor<ApifyComment>(
      APIFY_ACTORS.comments,
      { directUrls: [`https://www.instagram.com/p/${encodeURIComponent(shortcode)}/`], resultsLimit: limit },
      "instagram.comments"
    )
  ).map(toComment);
  const more = all.length >= limit && limit < MAX_RESULTS;
  return {
    comments: all.slice(shown),
    comment_count: all.length,
    has_more_comments: more,
    next_min_id: more ? String(limit) : undefined,
  };
}
