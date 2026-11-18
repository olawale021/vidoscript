"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { FB_VERSION, redirectUri } from "./social";

// Network side of social posting: OAuth token exchange, publishing, token
// refresh and stats. Tokens are decrypted only here.

// ── Token encryption (AES-256-GCM, key = SOCIAL_TOKEN_KEY, 32 bytes base64) ──

function key() {
  const k = Buffer.from(process.env.SOCIAL_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("SOCIAL_TOKEN_KEY must be 32 bytes, base64");
  return k;
}
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
export function decrypt(enc: string) {
  const [iv, tag, body] = enc.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

async function json(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const msg = data?.error?.error_user_msg || data?.error?.message || data?.error_message || data?.error_description || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data;
}

// ── Instagram (Instagram API with Instagram Login) ──

const IG_GRAPH = "https://graph.instagram.com/v23.0";
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
// Unified-login accounts use graph.facebook.com; Instagram-login ones graph.instagram.com.
const igBase = (account: Doc<"socialAccounts">) => (account.via === "facebook" ? FB_GRAPH : IG_GRAPH);

type ConnectedIg = {
  externalId: string;
  handle: string;
  name?: string;
  avatarUrl?: string;
};

// Unified login: code → system-user token (doesn't expire) → the Instagram
// account(s) the person granted in the configuration.
async function fbConnect(code: string) {
  const t = await json(
    await fetch(
      `${FB_GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri: redirectUri("instagram"),
        code,
      })}`
    )
  );
  const token = String(t.access_token);
  const fields = "id,username,name,profile_picture_url";
  let accounts: ConnectedIg[] = [];
  // 1) Instagram accounts shared with this business-integration token (per Meta's docs: id, username).
  const assigned = await fetch(`${FB_GRAPH}/me/assigned_instagram_accounts?${new URLSearchParams({ fields: "id,username", access_token: token })}`)
    .then((r) => r.json())
    .catch(() => null);
  if (Array.isArray(assigned?.data)) {
    for (const a of assigned.data as Record<string, string>[]) {
      // Name and picture are a nice-to-have; ignore if not available.
      const extra: { name?: string; profile_picture_url?: string } = await fetch(`${FB_GRAPH}/${a.id}?${new URLSearchParams({ fields: "name,profile_picture_url", access_token: token })}`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
      accounts.push({ externalId: String(a.id), handle: String(a.username ?? a.id), name: extra.name, avatarUrl: extra.profile_picture_url });
    }
  }
  // 2) Fallback: Instagram accounts linked to Facebook Pages the token can see.
  if (accounts.length === 0) {
    const pages = await fetch(
      `${FB_GRAPH}/me/accounts?${new URLSearchParams({ fields: `instagram_business_account{${fields}}`, access_token: token })}`
    )
      .then((r) => r.json())
      .catch(() => null);
    for (const p of pages?.data ?? []) {
      const a = p.instagram_business_account;
      if (a?.id) accounts.push({ externalId: String(a.id), handle: String(a.username ?? a.id), name: a.name, avatarUrl: a.profile_picture_url });
    }
  }
  if (accounts.length === 0) {
    const why = assigned?.error?.message ? ` (${assigned.error.message})` : "";
    throw new Error(`No Instagram account was shared. Connect again and select your Instagram account${why}.`);
  }
  return { token, accounts };
}

async function igConnect(code: string) {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    client_secret: process.env.INSTAGRAM_APP_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri("instagram"),
    code,
  });
  const short = await json(await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form }));
  // Swap the 1-hour token for a 60-day one.
  const long = await json(
    await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        access_token: short.access_token,
      })}`
    )
  );
  const me = await json(
    await fetch(`${IG_GRAPH}/me?${new URLSearchParams({ fields: "user_id,username,name,profile_picture_url,account_type", access_token: long.access_token })}`)
  );
  return {
    externalId: String(me.user_id ?? short.user_id),
    handle: String(me.username ?? ""),
    name: me.name ? String(me.name) : undefined,
    avatarUrl: me.profile_picture_url ? String(me.profile_picture_url) : undefined,
    accessToken: String(long.access_token),
    expiresAt: Date.now() + Number(long.expires_in ?? 5_184_000) * 1000,
    scopes: Array.isArray(short.permissions) ? short.permissions.map(String) : String(short.permissions ?? "").split(",").filter(Boolean),
  };
}

async function igRefresh(token: string) {
  const r = await json(
    await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`)
  );
  return { accessToken: String(r.access_token), expiresAt: Date.now() + Number(r.expires_in ?? 5_184_000) * 1000 };
}

// Reels: create a container from the video URL, wait for Instagram to process
// it, then publish. Returns the media id and permalink.
async function igPublish(ctx: ActionCtx, post: Doc<"socialPosts">, account: Doc<"socialAccounts">, videoUrl: string) {
  const token = decrypt(account.accessTokenEnc);
  const base = igBase(account);
  let containerId = post.containerId;
  if (!containerId) {
    await ctx.runMutation(internal.social.patchPost, { id: post._id, step: "Uploading to Instagram…" });
    const c = await json(
      await fetch(`${base}/${account.externalId}/media`, {
        method: "POST",
        body: new URLSearchParams({
          media_type: "REELS",
          video_url: videoUrl,
          caption: post.caption,
          share_to_feed: "true",
          ...(account.via === "facebook" && post.aiLabel ? { is_ai_generated: "true" } : {}),
          access_token: token,
        }),
      })
    );
    containerId = String(c.id);
    await ctx.runMutation(internal.social.patchPost, { id: post._id, containerId, step: "Instagram is processing the video…" });
  }
  const started = Date.now();
  for (;;) {
    const st = await json(await fetch(`${base}/${containerId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`));
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the video: ${st.status ?? st.status_code}`);
    if (Date.now() - started > 8 * 60_000) throw new Error("Instagram took too long to process the video. Try again.");
    await new Promise((r) => setTimeout(r, 30_000)); // Meta suggests polling about once a minute
  }
  await ctx.runMutation(internal.social.patchPost, { id: post._id, step: "Publishing…" });
  const pub = await json(
    await fetch(`${base}/${account.externalId}/media_publish`, {
      method: "POST",
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    })
  );
  const mediaId = String(pub.id);
  const media = await json(await fetch(`${base}/${mediaId}?${new URLSearchParams({ fields: "permalink", access_token: token })}`)).catch(() => ({}));
  return { platformPostId: mediaId, url: media.permalink ? String(media.permalink) : undefined };
}

async function igStats(account: Doc<"socialAccounts">, mediaId: string) {
  const token = decrypt(account.accessTokenEnc);
  const base = igBase(account);
  const media = await json(await fetch(`${base}/${mediaId}?${new URLSearchParams({ fields: "like_count,comments_count", access_token: token })}`));
  const out: Record<string, number> = { likes: Number(media.like_count ?? 0), comments: Number(media.comments_count ?? 0) };
  // Insights metrics vary by media type and API version: ask for each one
  // separately so one unsupported metric doesn't lose the rest.
  const map: Record<string, string> = { views: "views", reach: "reach", shares: "shares", saved: "saves", ig_reels_avg_watch_time: "avgWatchSec" };
  for (const [metric, field] of Object.entries(map)) {
    const r = await fetch(`${base}/${mediaId}/insights?${new URLSearchParams({ metric, access_token: token })}`);
    const d = await r.json().catch(() => ({}));
    const val = d?.data?.[0]?.values?.[0]?.value ?? d?.data?.[0]?.total_value?.value;
    if (r.ok && Number.isFinite(Number(val))) out[field] = field === "avgWatchSec" ? Number(val) / 1000 : Number(val);
  }
  return out;
}

// ── YouTube (Data API v3 + Analytics API, Google OAuth) ──

const YT = "https://www.googleapis.com/youtube/v3";

async function googleToken(params: Record<string, string>) {
  return await json(
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        ...params,
      }),
    })
  );
}

async function ytConnect(code: string) {
  const t = await googleToken({ code, grant_type: "authorization_code", redirect_uri: redirectUri("youtube") });
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Remove VidoScript from your Google account's third-party access and connect again.");
  const ch = await json(await fetch(`${YT}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${t.access_token}` } }));
  const c = ch.items?.[0];
  if (!c) throw new Error("This Google account has no YouTube channel. Create one on YouTube first.");
  return {
    externalId: String(c.id),
    handle: String(c.snippet?.customUrl ?? c.snippet?.title ?? c.id).replace(/^@/, ""),
    name: c.snippet?.title ? String(c.snippet.title) : undefined,
    avatarUrl: c.snippet?.thumbnails?.default?.url ? String(c.snippet.thumbnails.default.url) : undefined,
    accessToken: String(t.access_token),
    refreshToken: String(t.refresh_token),
    expiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000,
    scopes: String(t.scope ?? "").split(" ").filter(Boolean),
  };
}

// A valid access token (Google's last 1 hour; refresh when close to expiry).
async function ytAccess(ctx: ActionCtx, account: Doc<"socialAccounts">) {
  if ((account.tokenExpiresAt ?? 0) > Date.now() + 2 * 60_000) return decrypt(account.accessTokenEnc);
  if (!account.refreshTokenEnc) throw new Error("Sign-in expired. Reconnect YouTube.");
  try {
    const t = await googleToken({ grant_type: "refresh_token", refresh_token: decrypt(account.refreshTokenEnc) });
    await ctx.runMutation(internal.social.patchAccount, {
      id: account._id,
      accessTokenEnc: encrypt(String(t.access_token)),
      tokenExpiresAt: Date.now() + Number(t.expires_in ?? 3600) * 1000,
      lastError: null,
    });
    return String(t.access_token);
  } catch (e) {
    // invalid_grant = the user revoked access, or (while the Google app is in
    // "Testing") the 7-day refresh token ran out.
    if (/invalid_grant|expired|revoked/i.test(errText(e))) {
      await ctx.runMutation(internal.social.patchAccount, { id: account._id, status: "expired", lastError: "Sign-in expired. Reconnect YouTube." });
    }
    throw e;
  }
}

// Resumable upload: start a session with the metadata, then send the file.
async function ytPublish(ctx: ActionCtx, post: Doc<"socialPosts">, account: Doc<"socialAccounts">, videoUrl: string) {
  const token = await ytAccess(ctx, account);
  await ctx.runMutation(internal.social.patchPost, { id: post._id, step: "Downloading the video…" });
  const file = await fetch(videoUrl);
  if (!file.ok) throw new Error(`Couldn't read the video file (${file.status})`);
  const buf = Buffer.from(await file.arrayBuffer());
  const title = post.title.replace(/[<>]/g, "").slice(0, 100) || "Short";
  const description = post.caption.replace(/[<>]/g, "").slice(0, 4900);
  const meta = {
    snippet: {
      title,
      description,
      categoryId: "22", // People & Blogs
      tags: (description.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1)).slice(0, 15),
    },
    status: {
      privacyStatus: post.privacy ?? "public",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: !!post.aiLabel, // YouTube's "altered or synthetic content" disclosure
    },
  };
  await ctx.runMutation(internal.social.patchPost, { id: post._id, step: "Uploading to YouTube…" });
  const start = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(buf.length),
    },
    body: JSON.stringify(meta),
  });
  if (!start.ok) await json(start);
  const session = start.headers.get("location");
  if (!session) throw new Error("YouTube didn't start the upload.");
  const up = await json(await fetch(session, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length) }, body: buf }));
  const id = String(up.id);
  // Unverified Google projects: YouTube locks uploads to private.
  const locked = up.status?.privacyStatus === "private" && (post.privacy ?? "public") !== "private";
  return {
    platformPostId: id,
    url: `https://youtube.com/shorts/${id}`,
    note: locked ? "YouTube set this video to private (the app isn't verified by Google yet). Change it in YouTube Studio." : undefined,
  };
}

async function ytStats(ctx: ActionCtx, account: Doc<"socialAccounts">, videoId: string) {
  const token = await ytAccess(ctx, account);
  const v = await json(await fetch(`${YT}/videos?part=statistics&id=${videoId}`, { headers: { Authorization: `Bearer ${token}` } }));
  const s = v.items?.[0]?.statistics ?? {};
  const out: Record<string, number> = {
    views: Number(s.viewCount ?? 0),
    likes: Number(s.likeCount ?? 0),
    comments: Number(s.commentCount ?? 0),
  };
  // Analytics (shares, average watch time) lag a day or two; skip quietly if not there yet.
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch(
    `https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({
      ids: "channel==MINE",
      startDate: "2020-01-01",
      endDate: today,
      metrics: "shares,averageViewDuration",
      filters: `video==${videoId}`,
    })}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const a = await r.json().catch(() => ({}));
  const row = a?.rows?.[0];
  if (r.ok && Array.isArray(row)) {
    out.shares = Number(row[0] ?? 0);
    out.avgWatchSec = Number(row[1] ?? 0);
  }
  return out;
}

// ── TikTok (Login Kit + Content Posting API, Direct Post) ──

const TT = "https://open.tiktokapis.com/v2";

// TikTok wraps every answer as { data, error: { code: "ok" | ..., message } }.
// Plain-language versions of TikTok errors people actually hit.
const TT_FRIENDLY: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts:
    "TikTok only lets this app post to a private account until TikTok approves it. In TikTok: Settings and privacy → Privacy → turn on Private account, then Retry.",
  spam_risk_too_many_posts: "TikTok's daily posting limit for this account was reached. Try again tomorrow.",
  spam_risk_user_banned_from_posting: "TikTok has blocked posting from this account for now.",
  privacy_level_option_mismatch: "That privacy option isn't allowed for this TikTok account. Pick another one.",
  access_token_invalid: "TikTok sign-in expired. Reconnect TikTok in Settings.",
  scope_not_authorized: "TikTok didn't grant the posting permission. Reconnect TikTok and approve all permissions.",
};

async function ttJson(res: Response) {
  const d = await res.json().catch(() => ({}));
  const code = d?.error?.code;
  if (code && TT_FRIENDLY[code]) throw new Error(TT_FRIENDLY[code]);
  if (!res.ok || (code && code !== "ok")) {
    const msg = d?.error?.message || d?.error_description || d?.message || `TikTok HTTP ${res.status}`;
    throw new Error(code && code !== "ok" ? `${msg} (${code})` : String(msg));
  }
  return d;
}

async function ttToken(params: Record<string, string>) {
  const res = await fetch(`${TT}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, ...params }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(String(d.error_description || d.error || `TikTok HTTP ${res.status}`));
  return d;
}

async function ttConnect(code: string) {
  const t = await ttToken({ code, grant_type: "authorization_code", redirect_uri: redirectUri("tiktok") });
  const me = await ttJson(
    await fetch(`${TT}/user/info/?fields=open_id,avatar_url,display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } })
  );
  const u = me.data?.user ?? {};
  return {
    externalId: String(t.open_id ?? u.open_id),
    handle: String(u.display_name ?? "tiktok"),
    name: u.display_name ? String(u.display_name) : undefined,
    avatarUrl: u.avatar_url ? String(u.avatar_url) : undefined,
    accessToken: String(t.access_token),
    refreshToken: String(t.refresh_token),
    expiresAt: Date.now() + Number(t.expires_in ?? 86400) * 1000,
    scopes: String(t.scope ?? "").split(",").filter(Boolean),
  };
}

// Access tokens last 24 h; refresh tokens a year.
async function ttAccess(ctx: ActionCtx, account: Doc<"socialAccounts">) {
  if ((account.tokenExpiresAt ?? 0) > Date.now() + 5 * 60_000) return decrypt(account.accessTokenEnc);
  if (!account.refreshTokenEnc) throw new Error("Sign-in expired. Reconnect TikTok.");
  try {
    const t = await ttToken({ grant_type: "refresh_token", refresh_token: decrypt(account.refreshTokenEnc) });
    await ctx.runMutation(internal.social.patchAccount, {
      id: account._id,
      accessTokenEnc: encrypt(String(t.access_token)),
      ...(t.refresh_token ? { refreshTokenEnc: encrypt(String(t.refresh_token)) } : {}),
      tokenExpiresAt: Date.now() + Number(t.expires_in ?? 86400) * 1000,
      lastError: null,
    });
    return String(t.access_token);
  } catch (e) {
    await ctx.runMutation(internal.social.patchAccount, { id: account._id, status: "expired", lastError: "Sign-in expired. Reconnect TikTok." });
    throw e;
  }
}

type CreatorInfo = {
  nickname: string;
  avatarUrl: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number;
};

async function ttCreatorInfo(token: string): Promise<CreatorInfo> {
  const d = await ttJson(
    await fetch(`${TT}/post/publish/creator_info/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    })
  );
  const c = d.data ?? {};
  return {
    nickname: String(c.creator_nickname ?? c.creator_username ?? ""),
    avatarUrl: c.creator_avatar_url ? String(c.creator_avatar_url) : null,
    privacyOptions: Array.isArray(c.privacy_level_options) ? c.privacy_level_options.map(String) : [],
    commentDisabled: !!c.comment_disabled,
    duetDisabled: !!c.duet_disabled,
    stitchDisabled: !!c.stitch_disabled,
    maxDurationSec: Number(c.max_video_post_duration_sec ?? 600),
  };
}

// Direct Post with FILE_UPLOAD: init → PUT chunks → poll status.
async function ttPublish(ctx: ActionCtx, post: Doc<"socialPosts">, account: Doc<"socialAccounts">, videoUrl: string) {
  const token = await ttAccess(ctx, account);
  // TikTok wants a fresh creator-info check right before posting.
  const info = await ttCreatorInfo(token);
  if (!post.privacy || !info.privacyOptions.includes(post.privacy)) {
    throw new Error(`TikTok doesn't allow "${post.privacy}" for this account right now. Pick another privacy option.`);
  }
  await ctx.runMutation(internal.social.patchPost, { id: post._id, step: "Downloading the video…" });
  const file = await fetch(videoUrl);
  if (!file.ok) throw new Error(`Couldn't read the video file (${file.status})`);
  const buf = Buffer.from(await file.arrayBuffer());
  const size = buf.length;
  // TikTok: up to 64 MB goes as ONE chunk whose size is the whole file. Bigger
  // files: 10 MB chunks (5–64 MB allowed), count = floor(size / chunk), and the
  // last chunk takes the remainder (it may be up to 128 MB).
  const MB = 1024 * 1024;
  const chunkSize = size <= 64 * MB ? size : 10 * MB;
  const total = Math.max(1, Math.floor(size / chunkSize));
  const o = post.tiktok;
  const init = await ttJson(
    await fetch(`${TT}/post/publish/video/init/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: post.caption.slice(0, 2200),
          privacy_level: post.privacy,
          disable_comment: info.commentDisabled || !!o?.disableComment,
          disable_duet: info.duetDisabled || !!o?.disableDuet,
          disable_stitch: info.stitchDisabled || !!o?.disableStitch,
          brand_organic_toggle: !!o?.brandOrganic,
          brand_content_toggle: !!o?.brandContent,
          is_aigc: !!post.aiLabel,
          video_cover_timestamp_ms: 1000,
        },
        source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: total },
      }),
    })
  );
  const publishId = String(init.data.publish_id);
  await ctx.runMutation(internal.social.patchPost, { id: post._id, containerId: publishId, step: "Uploading to TikTok…" });
  for (let i = 0; i < total; i++) {
    const start = i * chunkSize;
    const end = i === total - 1 ? size : start + chunkSize; // the last chunk takes the remainder
    const res = await fetch(String(init.data.upload_url), {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${size}` },
      body: buf.subarray(start, end),
    });
    if (!res.ok && res.status !== 201 && res.status !== 206) throw new Error(`TikTok upload failed at part ${i + 1} (${res.status})`);
  }
  await ctx.runMutation(internal.social.patchPost, { id: post._id, step: "TikTok is processing the video…" });
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 8_000));
    const st = await ttJson(
      await fetch(`${TT}/post/publish/status/fetch/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId }),
      })
    );
    const s = st.data ?? {};
    if (s.status === "PUBLISH_COMPLETE") {
      // (sic) TikTok's field name. Empty for private (SELF_ONLY) posts.
      const ids: string[] = (s.publicaly_available_post_id ?? s.publicly_available_post_id ?? []).map(String);
      // The real link comes from the video query (share_url).
      const shared = ids[0] ? await ttStats(ctx, account, ids[0]).catch(() => null) : null;
      return {
        platformPostId: ids[0] ?? publishId,
        url: shared?.url,
        note:
          post.privacy === "SELF_ONLY" || !ids[0]
            ? "Posted as private (\"Only me\"). Unaudited TikTok apps can only post privately: change it to public in the TikTok app."
            : undefined,
      };
    }
    if (s.status === "FAILED") throw new Error(`TikTok couldn't post it: ${s.fail_reason ?? "unknown reason"}`);
    if (Date.now() - started > 8 * 60_000) throw new Error("TikTok took too long to process the video. Check the TikTok app before retrying.");
  }
}

async function ttStats(ctx: ActionCtx, account: Doc<"socialAccounts">, videoId: string) {
  if (!/^\d+$/.test(videoId)) return null; // private post: no public id to query
  const token = await ttAccess(ctx, account);
  const d = await ttJson(
    await fetch(`${TT}/video/query/?fields=id,view_count,like_count,comment_count,share_count,share_url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ filters: { video_ids: [videoId] } }),
    })
  );
  const vid = d.data?.videos?.[0];
  if (!vid) return null;
  return {
    stats: {
      views: Number(vid.view_count ?? 0),
      likes: Number(vid.like_count ?? 0),
      comments: Number(vid.comment_count ?? 0),
      shares: Number(vid.share_count ?? 0),
    },
    url: vid.share_url ? String(vid.share_url) : undefined,
  };
}

// A post made as "Only me" has no public id. Once the creator makes it public
// in the TikTok app it shows up in their video list: match it by caption and
// posting time (within 30 min).
async function ttFindPublic(ctx: ActionCtx, account: Doc<"socialAccounts">, post: Doc<"socialPosts">) {
  const token = await ttAccess(ctx, account);
  const postedAt = (post.publishedAt ?? post.createdAt) / 1000;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  let cursor: number | undefined;
  for (let page = 0; page < 3; page++) {
    const d = await ttJson(
      await fetch(`${TT}/video/list/?fields=id,title,video_description,create_time,share_url`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }),
      })
    );
    const vids: { id: string; title?: string; video_description?: string; create_time?: number; share_url?: string }[] = d.data?.videos ?? [];
    const hit = vids.find(
      (x) =>
        Math.abs(Number(x.create_time ?? 0) - postedAt) < 30 * 60 &&
        norm(x.video_description || x.title || "") === norm(post.caption)
    );
    if (hit) return { id: String(hit.id), url: hit.share_url ? String(hit.share_url) : undefined };
    // The list is newest first: stop once we're past the posting time.
    if (!d.data?.has_more || vids.some((x) => Number(x.create_time ?? 0) < postedAt - 3600)) break;
    cursor = d.data?.cursor;
  }
  return null;
}

// For the Post dialog: the creator's TikTok settings (TikTok requires showing these).
export const tiktokCreatorInfo = action({
  args: { accountId: v.id("socialAccounts") },
  handler: async (ctx, { accountId }): Promise<CreatorInfo> => {
    const identity = await ctx.auth.getUserIdentity();
    const account: Doc<"socialAccounts"> | null = await ctx.runQuery(internal.social.accountById, { id: accountId });
    if (!identity || !account || account.userId !== identity.subject || account.platform !== "tiktok") throw new Error("Not found");
    return await ttCreatorInfo(await ttAccess(ctx, account));
  },
});

// ── Socials page sync: profile numbers + the account's latest videos ──

type Media = {
  externalId: string;
  title: string;
  thumbnailUrl?: string;
  url?: string;
  publishedAt: number;
  durationSec?: number;
  kind?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};
type Profile = { followers?: number; following?: number; videoCount?: number; totalViews?: number; totalLikes?: number };
const num = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? undefined : Number(x));
const isoSec = (d: string | undefined) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0) : undefined;
};

async function ytSync(ctx: ActionCtx, account: Doc<"socialAccounts">): Promise<{ profile: Profile; media: Media[]; avatarUrl?: string }> {
  const token = await ytAccess(ctx, account);
  const h = { headers: { Authorization: `Bearer ${token}` } };
  const ch = (await json(await fetch(`${YT}/channels?part=snippet,statistics,contentDetails&mine=true`, h))).items?.[0];
  if (!ch) throw new Error("Channel not found");
  const profile: Profile = {
    followers: ch.statistics?.hiddenSubscriberCount ? undefined : num(ch.statistics?.subscriberCount),
    videoCount: num(ch.statistics?.videoCount),
    totalViews: num(ch.statistics?.viewCount),
  };
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { profile, media: [] };
  const pl = await json(await fetch(`${YT}/playlistItems?part=contentDetails&maxResults=30&playlistId=${uploads}`, h));
  const ids = (pl.items ?? []).map((x: { contentDetails?: { videoId?: string } }) => x.contentDetails?.videoId).filter(Boolean);
  if (ids.length === 0) return { profile, media: [], avatarUrl: ch.snippet?.thumbnails?.default?.url };
  const vids = await json(await fetch(`${YT}/videos?part=snippet,statistics,contentDetails,status&id=${ids.join(",")}`, h));
  const media: Media[] = (vids.items ?? []).map((x: Record<string, any>) => {
    const dur = isoSec(x.contentDetails?.duration);
    return {
      externalId: String(x.id),
      title: String(x.snippet?.title ?? ""),
      thumbnailUrl: x.snippet?.thumbnails?.medium?.url ?? x.snippet?.thumbnails?.default?.url,
      url: dur != null && dur <= 180 ? `https://youtube.com/shorts/${x.id}` : `https://youtube.com/watch?v=${x.id}`,
      publishedAt: Date.parse(x.snippet?.publishedAt ?? "") || Date.now(),
      durationSec: dur,
      kind: x.status?.privacyStatus && x.status.privacyStatus !== "public" ? `${dur != null && dur <= 180 ? "short" : "video"} · ${x.status.privacyStatus}` : dur != null && dur <= 180 ? "short" : "video",
      views: num(x.statistics?.viewCount),
      likes: num(x.statistics?.likeCount),
      comments: num(x.statistics?.commentCount),
    };
  });
  return { profile, media, avatarUrl: ch.snippet?.thumbnails?.default?.url };
}

async function igSync(account: Doc<"socialAccounts">): Promise<{ profile: Profile; media: Media[]; avatarUrl?: string }> {
  const token = decrypt(account.accessTokenEnc);
  const base = igBase(account);
  const me = await json(
    await fetch(`${base}/${account.externalId}?${new URLSearchParams({ fields: "followers_count,follows_count,media_count,profile_picture_url", access_token: token })}`)
  );
  const list = await json(
    await fetch(
      `${base}/${account.externalId}/media?${new URLSearchParams({
        fields: "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,like_count,comments_count",
        limit: "30",
        access_token: token,
      })}`
    )
  );
  const media: Media[] = (list.data ?? []).map((x: Record<string, any>) => ({
    externalId: String(x.id),
    title: String(x.caption ?? "").split("\n")[0].slice(0, 200),
    thumbnailUrl: x.thumbnail_url ?? (x.media_type === "IMAGE" ? x.media_url : undefined),
    url: x.permalink,
    publishedAt: Date.parse(x.timestamp ?? "") || Date.now(),
    kind: x.media_product_type === "REELS" ? "reel" : String(x.media_type ?? "post").toLowerCase().replace("_album", ""),
    likes: num(x.like_count),
    comments: num(x.comments_count),
  }));
  // Views aren't in the media list: ask insights for each Reel/video, 5 at a time.
  // (Needs instagram_manage_insights; posts without it just show likes/comments.)
  const videos = media.filter((m) => m.kind === "reel" || m.kind === "video").slice(0, 25);
  for (let i = 0; i < videos.length; i += 5) {
    await Promise.all(
      videos.slice(i, i + 5).map(async (m) => {
        const r = await fetch(`${base}/${m.externalId}/insights?${new URLSearchParams({ metric: "views", access_token: token })}`).catch(() => null);
        const d = r ? await r.json().catch(() => ({})) : {};
        const val = d?.data?.[0]?.values?.[0]?.value ?? d?.data?.[0]?.total_value?.value;
        if (r?.ok && Number.isFinite(Number(val))) m.views = Number(val);
      })
    );
  }
  return {
    profile: {
      followers: num(me.followers_count),
      following: num(me.follows_count),
      videoCount: num(me.media_count),
      totalViews: videos.some((m) => m.views != null) ? videos.reduce((s, m) => s + (m.views ?? 0), 0) : undefined,
    },
    media,
    avatarUrl: me.profile_picture_url,
  };
}

async function ttSync(ctx: ActionCtx, account: Doc<"socialAccounts">): Promise<{ profile: Profile; media: Media[]; avatarUrl?: string }> {
  if (account.scopes && !account.scopes.includes("video.list")) return { profile: {}, media: [] };
  const token = await ttAccess(ctx, account);
  const d = await ttJson(
    await fetch(`${TT}/video/list/?fields=id,title,video_description,cover_image_url,share_url,create_time,duration,view_count,like_count,comment_count,share_count`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ max_count: 20 }),
    })
  );
  const media: Media[] = (d.data?.videos ?? []).map((x: Record<string, any>) => ({
    externalId: String(x.id),
    title: String(x.title || x.video_description || "").slice(0, 200),
    thumbnailUrl: x.cover_image_url,
    url: x.share_url,
    publishedAt: Number(x.create_time ?? 0) * 1000 || Date.now(),
    durationSec: num(x.duration),
    kind: "video",
    views: num(x.view_count),
    likes: num(x.like_count),
    comments: num(x.comment_count),
    shares: num(x.share_count),
  }));
  // Followers etc. need user.info.stats (granted on connect when the app has it).
  let profile: Profile = { videoCount: media.length || undefined };
  if (!account.scopes || account.scopes.includes("user.info.stats")) {
    const u = await ttJson(
      await fetch(`${TT}/user/info/?fields=avatar_url,follower_count,following_count,likes_count,video_count`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    )
      .then((r) => r.data?.user ?? {})
      .catch(() => ({}));
    profile = {
      followers: num(u.follower_count),
      following: num(u.following_count),
      videoCount: num(u.video_count) ?? profile.videoCount,
      totalLikes: num(u.likes_count),
    };
  }
  return { profile, media };
}

async function syncOne(ctx: ActionCtx, account: Doc<"socialAccounts">) {
  try {
    const r =
      account.platform === "youtube" ? await ytSync(ctx, account) : account.platform === "tiktok" ? await ttSync(ctx, account) : await igSync(account);
    await ctx.runMutation(internal.social.saveSync, { accountId: account._id, profile: r.profile, avatarUrl: r.avatarUrl, media: r.media });
  } catch (e) {
    await ctx.runMutation(internal.social.saveSync, { accountId: account._id, media: [], error: errText(e) });
  }
}

// Socials page: refresh the signed-in user's accounts (skips ones synced in the last 15 min unless forced).
export const syncAccounts = action({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    const data: { accounts: Doc<"socialAccounts">[] } | null = await ctx.runQuery(internal.social.myAccountsFull, { userId: identity.subject });
    let n = 0;
    for (const a of data?.accounts ?? []) {
      if (a.status !== "active") continue;
      if (!force && a.syncedAt && Date.now() - a.syncedAt < 15 * 60_000) continue;
      await syncOne(ctx, a);
      n++;
    }
    return n;
  },
});

// ── Actions ──

// Called by the HTTP callback route with the platform's code.
export const finishConnect = internalAction({
  args: { platform: v.string(), code: v.string(), state: v.string() },
  handler: async (ctx, { platform, code, state }): Promise<{ returnTo: string; ok: boolean; message?: string }> => {
    const pending: Doc<"socialConnects"> | null = await ctx.runMutation(internal.social.takeConnect, { state });
    if (!pending || pending.platform !== platform) return { returnTo: "https://app.vidoscript.app", ok: false, message: "This sign-in link expired. Try connecting again." };
    try {
      if (platform !== "instagram" && platform !== "youtube" && platform !== "tiktok") throw new Error(`Unknown platform ${platform}`);
      if (platform === "instagram" && process.env.INSTAGRAM_CONFIG_ID) {
        const r = await fbConnect(code);
        for (const acc of r.accounts) {
          await ctx.runMutation(internal.social.saveAccount, {
            userId: pending.userId,
            platform: "instagram",
            ...acc,
            accessTokenEnc: encrypt(r.token),
            via: "facebook",
          });
        }
        return { returnTo: pending.returnTo, ok: true };
      }
      const a: Awaited<ReturnType<typeof igConnect>> & { refreshToken?: string } =
        platform === "youtube" ? await ytConnect(code) : platform === "tiktok" ? await ttConnect(code) : await igConnect(code);
      await ctx.runMutation(internal.social.saveAccount, {
        userId: pending.userId,
        platform,
        externalId: a.externalId,
        handle: a.handle,
        name: a.name,
        avatarUrl: a.avatarUrl,
        accessTokenEnc: encrypt(a.accessToken),
        ...(a.refreshToken ? { refreshTokenEnc: encrypt(a.refreshToken) } : {}),
        tokenExpiresAt: a.expiresAt,
        scopes: a.scopes,
      });
      return { returnTo: pending.returnTo, ok: true };
    } catch (e) {
      return { returnTo: pending.returnTo, ok: false, message: errText(e) };
    }
  },
});

export const publish = internalAction({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }): Promise<null> => {
    const info: { post: Doc<"socialPosts">; account: Doc<"socialAccounts"> | null; videoUrl: string | null } | null =
      await ctx.runQuery(internal.social.publishInfo, { postId });
    if (!info || (info.post.status !== "queued" && info.post.status !== "posting")) return null;
    const { post, account, videoUrl } = info;
    const fail = (error: string) => ctx.runMutation(internal.social.patchPost, { id: postId, status: "failed", error, step: undefined });
    if (!account || account.status !== "active") {
      await fail("The account isn't connected any more. Reconnect it and retry.");
      return null;
    }
    if (!videoUrl) {
      await fail("The video file is missing. Export it again.");
      return null;
    }
    await ctx.runMutation(internal.social.patchPost, { id: postId, status: "posting", error: null });
    try {
      const r: { platformPostId: string; url?: string; note?: string } =
        post.platform === "youtube"
          ? await ytPublish(ctx, post, account, videoUrl)
          : post.platform === "tiktok"
            ? await ttPublish(ctx, post, account, videoUrl)
            : await igPublish(ctx, post, account, videoUrl);
      await ctx.runMutation(internal.social.patchPost, {
        id: postId,
        status: "published",
        step: undefined,
        error: r.note ?? null,
        platformPostId: r.platformPostId,
        url: r.url,
        publishedAt: Date.now(),
      });
    } catch (e) {
      await fail(errText(e));
    }
    return null;
  },
});

// Cron: publish scheduled posts that are due.
export const runScheduled = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const ids: Id<"socialPosts">[] = await ctx.runMutation(internal.social.duePosts, {});
    for (const id of ids) await ctx.scheduler.runAfter(0, internal.socialNode.publish, { postId: id });
    return null;
  },
});

// Cron: refresh tokens that expire within 10 days.
export const refreshTokens = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const due: Doc<"socialAccounts">[] = await ctx.runQuery(internal.social.expiringAccounts, { withinMs: 10 * 86_400_000 });
    for (const a of due) {
      try {
        if (a.platform !== "instagram") continue; // YouTube refreshes on demand (1-hour tokens)
        if ((a.tokenExpiresAt ?? 0) < Date.now()) {
          await ctx.runMutation(internal.social.patchAccount, { id: a._id, status: "expired", lastError: "Sign-in expired. Reconnect." });
          continue;
        }
        const r = await igRefresh(decrypt(a.accessTokenEnc));
        await ctx.runMutation(internal.social.patchAccount, { id: a._id, accessTokenEnc: encrypt(r.accessToken), tokenExpiresAt: r.expiresAt, lastError: null });
      } catch (e) {
        await ctx.runMutation(internal.social.patchAccount, { id: a._id, lastError: errText(e) });
      }
    }
    return null;
  },
});

// Cron: fetch stats for published posts that are due.
export const collectStats = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const due: Doc<"socialPosts">[] = await ctx.runQuery(internal.social.statsDue, {});
    for (const p of due) {
      if (!p.platformPostId) continue;
      const account: Doc<"socialAccounts"> | null = await ctx.runQuery(internal.social.accountById, { id: p.accountId });
      if (!account || account.status !== "active") continue;
      try {
        if (p.platform === "tiktok") {
          if (account.scopes && !account.scopes.includes("video.list")) continue; // no stats permission yet
          let videoId = p.platformPostId;
          if (!/^\d+$/.test(videoId)) {
            // Posted privately: has it been made public since?
            const found = await ttFindPublic(ctx, account, p);
            if (!found) continue;
            videoId = found.id;
            await ctx.runMutation(internal.social.patchPost, { id: p._id, platformPostId: found.id, url: found.url, error: null });
          }
          const r = await ttStats(ctx, account, videoId);
          if (r) {
            await ctx.runMutation(internal.social.saveStats, { postId: p._id, stats: r.stats });
            if (r.url && r.url !== p.url) await ctx.runMutation(internal.social.patchPost, { id: p._id, url: r.url });
          }
          continue;
        }
        const stats = p.platform === "youtube" ? await ytStats(ctx, account, p.platformPostId) : await igStats(account, p.platformPostId);
        await ctx.runMutation(internal.social.saveStats, { postId: p._id, stats });
      } catch (e) {
        console.warn(`[social] stats ${p._id}: ${errText(e)}`);
      }
    }
    return null;
  },
});
