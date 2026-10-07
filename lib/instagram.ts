import type {
  InstagramUserLookup,
  InstagramFeed,
  InstagramPost,
  InstagramProfile,
  InstagramCommentsResponse,
  HashtagFeedResponse,
} from "@/types/instagram";

export type { InstagramUserLookup, InstagramFeed, InstagramPost, InstagramProfile };

const RAPIDAPI_HOST = "instagram-best-experience.p.rapidapi.com";

function getApiKey(): string {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("RAPIDAPI_KEY is not configured");
  return key;
}

function headers() {
  return {
    "x-rapidapi-key": getApiKey(),
    "x-rapidapi-host": RAPIDAPI_HOST,
  };
}

export async function getUserIdByUsername(
  username: string
): Promise<InstagramUserLookup> {
  const res = await fetch(
    `https://${RAPIDAPI_HOST}/user_id_by_username?username=${encodeURIComponent(username)}`,
    { method: "GET", headers: headers() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instagram API error (${res.status}): ${text}`);
  }

  const data: InstagramUserLookup = await res.json();
  if (!data.UserID) {
    throw new Error(`User "${username}" not found`);
  }
  return data;
}

export async function getUserProfile(username: string): Promise<InstagramProfile> {
  const res = await fetch(
    `https://${RAPIDAPI_HOST}/profile?username=${encodeURIComponent(username)}`,
    { method: "GET", headers: headers() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instagram API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getUserFeed(userId: string, nextMaxId?: string): Promise<InstagramFeed> {
  const params = new URLSearchParams({ user_id: userId });
  if (nextMaxId) {
    params.set("next_max_id", nextMaxId);
  }

  const res = await fetch(
    `https://${RAPIDAPI_HOST}/feed?${params.toString()}`,
    { method: "GET", headers: headers() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instagram API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getPostByShortcode(
  shortcode: string
): Promise<InstagramPost> {
  const res = await fetch(
    `https://${RAPIDAPI_HOST}/post?shortcode=${encodeURIComponent(shortcode)}`,
    { method: "GET", headers: headers() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instagram API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getHashtagFeed(
  tag: string,
  section: string = "recent",
  pagination?: { max_id: string; page: string; rank_token: string }
): Promise<HashtagFeedResponse> {
  const params = new URLSearchParams({ tag, section });
  if (pagination) {
    params.set("max_id", pagination.max_id);
    params.set("page", pagination.page);
    params.set("rank_token", pagination.rank_token);
  }

  const res = await fetch(
    `https://${RAPIDAPI_HOST}/hashtag_section?${params.toString()}`,
    { method: "GET", headers: headers() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instagram API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getMediaComments(
  mediaId: string,
  nextMinId?: string
): Promise<InstagramCommentsResponse> {
  const params = new URLSearchParams({ id: mediaId });
  if (nextMinId) {
    params.set("next_min_id", nextMinId);
  }

  const res = await fetch(
    `https://${RAPIDAPI_HOST}/comments?${params.toString()}`,
    { method: "GET", headers: headers() }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instagram API error (${res.status}): ${text}`);
  }

  return res.json();
}
