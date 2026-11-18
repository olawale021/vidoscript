"use node";

import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { commentMoments, median, parseDuration, scoreVideo, looksNonEnglish, ENGLISH_COUNTRIES, QUOTA_SCAN_LIMIT, type ScoutMoment } from "./scoutLib";

// Clip scout: YouTube Data API v3 (YOUTUBE_API_KEY, 10,000 free units/day for
// the whole app), Gemini for the "why it'll clip" note, and an Apify actor for
// YouTube's "most replayed" heatmap. Only on-demand actions bypass the scan limit.

const YT = "https://www.googleapis.com/youtube/v3";
const HEATMAP_ACTOR = "karamelo~youtube-most-replayed-scraper-heatmap-extractor";
const HEATMAP_USD = 0.005; // Apify free tier price per video
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_PRICE = { input: 0.3, output: 2.5 }; // per 1M tokens

const UNITS = { search: 100, list: 1 };

async function yt(ctx: ActionCtx, path: string, params: Record<string, string | number>, units: number) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YouTube API key is missing. Add YOUTUBE_API_KEY to the Convex environment.");
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), key });
  const res = await fetch(`${YT}/${path}?${qs}`);
  await ctx.runMutation(internal.scout.addQuota, { units });
  if (!res.ok) {
    const body = await res.text();
    if (/quotaExceeded/i.test(body)) throw new Error("Today's YouTube quota is used up. Scans resume after midnight UTC.");
    throw new Error(`YouTube ${path} failed (${res.status}): ${body.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown> & { items?: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function requireUserId(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

// ── Channels ──

// Accepts a channel URL, /channel/UC…, @handle or a plain name.
async function resolveChannel(ctx: ActionCtx, input: string) {
  const text = input.trim();
  const id = text.match(/(UC[\w-]{22})/)?.[1];
  const handle = text.match(/@([\w.-]{3,})/)?.[1];
  let item: Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (id) item = (await yt(ctx, "channels", { part: "snippet,contentDetails", id }, UNITS.list)).items?.[0];
  else if (handle) item = (await yt(ctx, "channels", { part: "snippet,contentDetails", forHandle: `@${handle}` }, UNITS.list)).items?.[0];
  if (!item) {
    const found = (await yt(ctx, "search", { part: "snippet", type: "channel", q: text, maxResults: 1 }, UNITS.search)).items?.[0];
    const cid = found?.snippet?.channelId ?? found?.id?.channelId;
    if (cid) item = (await yt(ctx, "channels", { part: "snippet,contentDetails", id: cid }, UNITS.list)).items?.[0];
  }
  if (!item) throw new Error("Couldn't find that channel. Paste its link or @handle.");
  return {
    channelId: item.id as string,
    channelTitle: item.snippet?.title as string,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads as string,
  };
}

export const addChannel = action({
  args: { input: v.string(), clipFriendly: v.optional(v.boolean()) },
  handler: async (ctx, { input, clipFriendly }): Promise<Id<"scoutTargets">> => {
    const userId = await requireUserId(ctx);
    const ch = await resolveChannel(ctx, input);
    return await ctx.runMutation(internal.scout.insertChannelTarget, {
      userId,
      query: input.trim().slice(0, 200),
      ...ch,
      clipFriendly: clipFriendly ?? false,
    });
  },
});

// Median views of a channel's last ~15 uploads (cached for a day).
async function channelBaselines(ctx: ActionCtx, channelIds: string[]) {
  const cached: Doc<"scoutChannels">[] = await ctx.runQuery(internal.scout.channelCache, { channelIds });
  const fresh = new Map(cached.filter((c) => c.updatedAt > Date.now() - 86_400_000).map((c) => [c.channelId, c]));
  const missing = channelIds.filter((id) => !fresh.has(id));
  const saved: { channelId: string; title: string; uploadsPlaylistId: string; medianViews: number | null; country?: string }[] = [];
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const chans = await yt(ctx, "channels", { part: "snippet,contentDetails", id: batch.join(",") }, UNITS.list);
    for (const c of chans.items ?? []) {
      const uploads = c.contentDetails?.relatedPlaylists?.uploads as string | undefined;
      let medianViews: number | null = null;
      if (uploads) {
        const pl = await yt(ctx, "playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 15 }, UNITS.list).catch(() => null);
        const ids = (pl?.items ?? []).map((x) => x.contentDetails?.videoId).filter(Boolean);
        if (ids.length) {
          const st = await yt(ctx, "videos", { part: "statistics", id: ids.join(",") }, UNITS.list).catch(() => null);
          medianViews = median((st?.items ?? []).map((x) => Number(x.statistics?.viewCount ?? 0)));
        }
      }
      const country = c.snippet?.country ? String(c.snippet.country).toUpperCase() : undefined;
      saved.push({ channelId: c.id, title: c.snippet?.title ?? "", uploadsPlaylistId: uploads ?? "", medianViews, ...(country ? { country } : {}) });
    }
  }
  if (saved.length) await ctx.runMutation(internal.scout.saveChannels, { channels: saved });
  const out = new Map<string, { median: number | null; country?: string }>();
  for (const [id, c] of fresh) out.set(id, { median: c.medianViews, country: c.country });
  for (const c of saved) out.set(c.channelId, { median: c.medianViews, country: c.country });
  return out;
}

// ── Scanning ──

async function topComments(ctx: ActionCtx, videoId: string) {
  const r = await yt(
    ctx,
    "commentThreads",
    { part: "snippet", videoId, order: "relevance", maxResults: 100, textFormat: "plainText" },
    UNITS.list
  ).catch(() => null); // comments may be disabled
  return (r?.items ?? []).map((x) => ({
    text: String(x.snippet?.topLevelComment?.snippet?.textDisplay ?? ""),
    likes: Number(x.snippet?.topLevelComment?.snippet?.likeCount ?? 0),
  }));
}

async function scanTarget(ctx: ActionCtx, target: Doc<"scoutTargets">) {
  const prefs: { windowDays: number; language: "en" | "any" } = await ctx.runQuery(internal.scout.scanSettings, { userId: target.userId });
  const englishOnly = prefs.language === "en";
  // 1. Candidate videos.
  let ids: string[] = [];
  if (target.kind === "keyword") {
    const since = new Date(Date.now() - prefs.windowDays * 86_400_000).toISOString();
    const r = await yt(
      ctx,
      "search",
      {
        part: "id",
        type: "video",
        q: target.query,
        order: "viewCount",
        videoDuration: "long",
        publishedAfter: since,
        maxResults: prefs.windowDays > 7 ? 40 : 25,
        ...(englishOnly ? { relevanceLanguage: "en" } : {}),
      },
      UNITS.search
    );
    ids = (r.items ?? []).map((x) => x.id?.videoId).filter(Boolean);
  } else if (target.uploadsPlaylistId) {
    const r = await yt(ctx, "playlistItems", { part: "contentDetails", playlistId: target.uploadsPlaylistId, maxResults: 10 }, UNITS.list);
    const cutoff = Date.now() - Math.max(21, prefs.windowDays) * 86_400_000;
    ids = (r.items ?? [])
      .filter((x) => Date.parse(x.contentDetails?.videoPublishedAt ?? 0) > cutoff)
      .map((x) => x.contentDetails?.videoId)
      .filter(Boolean);
  }
  if (ids.length === 0) return 0;

  // 2. Stats, length, keep long talk-friendly videos that aren't live/upcoming.
  const st = await yt(ctx, "videos", { part: "snippet,statistics,contentDetails", id: ids.slice(0, 50).join(",") }, UNITS.list);
  const vids = (st.items ?? [])
    .map((x) => ({
      videoId: x.id as string,
      title: String(x.snippet?.title ?? ""),
      description: String(x.snippet?.description ?? ""),
      channelId: String(x.snippet?.channelId ?? ""),
      channelTitle: String(x.snippet?.channelTitle ?? ""),
      thumbnail: (x.snippet?.thumbnails?.high?.url ?? x.snippet?.thumbnails?.medium?.url) as string | undefined,
      publishedAt: Date.parse(x.snippet?.publishedAt ?? ""),
      durationSec: parseDuration(x.contentDetails?.duration),
      views: Number(x.statistics?.viewCount ?? 0),
      likes: Number(x.statistics?.likeCount ?? 0),
      comments: Number(x.statistics?.commentCount ?? 0),
      live: x.snippet?.liveBroadcastContent !== "none",
      lang: String(x.snippet?.defaultAudioLanguage ?? x.snippet?.defaultLanguage ?? ""),
    }))
    // Keyword results are English-first: skip videos tagged with another spoken
    // language (untagged videos are kept). Watched channels are always kept.
    .filter(
      (x) =>
        target.kind === "channel" ||
        !englishOnly ||
        ((!x.lang || x.lang.toLowerCase().startsWith("en")) && !looksNonEnglish(`${x.title} ${x.description.slice(0, 300)}`))
    )
    .filter((x) => !x.live && x.durationSec >= 15 * 60 && Number.isFinite(x.publishedAt));
  if (vids.length === 0) return 0;

  // 3. Channel baselines + first-pass score. English only: keyword results from
  // channels based outside English-speaking countries are dropped (no country = kept).
  const allBaselines = await channelBaselines(ctx, [...new Set(vids.map((x) => x.channelId))]);
  if (englishOnly && target.kind === "keyword") {
    const keep = vids.filter((x) => {
      const c = allBaselines.get(x.channelId)?.country;
      return !c || ENGLISH_COUNTRIES.has(c);
    });
    vids.splice(0, vids.length, ...keep);
    if (vids.length === 0) return 0;
  }
  const baselines = new Map([...allBaselines].map(([id, b]) => [id, b.median]));
  const known: Doc<"scoutVideos">[] = await ctx.runQuery(internal.scout.knownVideos, {
    userId: target.userId,
    videoIds: vids.map((x) => x.videoId),
  });
  const knownById = new Map(known.map((k) => [k.videoId, k]));
  const scored = vids.map((x) => {
    const median = baselines.get(x.channelId) ?? null;
    const old = knownById.get(x.videoId);
    const { score, breakdown } = scoreVideo({
      ...x,
      channelMedianViews: median,
      moments: old?.moments ?? [],
      competitionShorts: old?.competition?.shorts ?? null,
    });
    return { ...x, median, score, breakdown };
  });

  // 4. Comments → moments for the best 8 that don't have them yet (1 unit each).
  scored.sort((a, b) => b.score - a.score);
  const withMoments = new Map<string, ScoutMoment[]>();
  for (const x of scored.slice(0, 8)) {
    const old = knownById.get(x.videoId);
    if (old?.moments.some((m) => m.source === "comments")) continue;
    withMoments.set(x.videoId, commentMoments(await topComments(ctx, x.videoId), x.durationSec));
  }

  // 5. Save (final score includes the comment moments).
  await ctx.runMutation(internal.scout.upsertVideos, {
    userId: target.userId,
    targetId: target._id,
    clipFriendly: target.clipFriendly,
    videos: scored.map((x) => {
      const fresh = withMoments.get(x.videoId);
      const old = knownById.get(x.videoId);
      const moments = fresh ? [...fresh, ...(old?.moments.filter((m) => m.source !== "comments") ?? [])] : old?.moments ?? [];
      const { score, breakdown } = scoreVideo({
        ...x,
        channelMedianViews: x.median,
        moments,
        competitionShorts: old?.competition?.shorts ?? null,
      });
      return {
        videoId: x.videoId,
        title: x.title.slice(0, 300),
        channelId: x.channelId,
        channelTitle: x.channelTitle.slice(0, 120),
        thumbnail: x.thumbnail,
        publishedAt: x.publishedAt,
        durationSec: x.durationSec,
        views: x.views,
        likes: x.likes,
        comments: x.comments,
        ...(x.median != null ? { channelMedianViews: x.median } : {}),
        score,
        breakdown,
        ...(fresh ? { moments: fresh } : {}),
      };
    }),
  });
  return scored.length;
}

// ── AI note ("why it'll clip") + taste fit ──

type Taste = { likes: string[]; dislikes: string[]; keywords: string[]; niches: string[] };

async function gemini(ctx: ActionCtx, userId: string, feature: string, prompt: string): Promise<unknown | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const u = data.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  await ctx.runMutation(internal.usage.recordInternal, {
    userId,
    provider: "gemini",
    model: GEMINI_MODEL,
    feature,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * GEMINI_PRICE.input + outputTokens * GEMINI_PRICE.output) / 1_000_000,
  });
  try {
    return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "null");
  } catch {
    return null;
  }
}

const hasTaste = (t: Taste) => t.likes.length + t.dislikes.length + t.niches.length > 0;

function tasteBlock(t: Taste) {
  return `${t.niches.length ? `The user's clip niches: ${t.niches.join(", ")}.\n` : ""}The user rated earlier finds. What they LIKED:
${t.likes.map((x) => `+ ${x}`).join("\n") || "(none yet)"}
What they DISLIKED:
${t.dislikes.map((x) => `- ${x}`).join("\n") || "(none yet)"}`;
}

async function analyze(ctx: ActionCtx, video: Doc<"scoutVideos">, comments: { text: string; likes: number }[], taste: Taste) {
  const withTaste = hasTaste(taste);
  const prompt = `You scout long YouTube videos for short-form clip potential (Shorts/TikTok/Reels).
Video: "${video.title}" by ${video.channelTitle}, ${Math.round(video.durationSec / 60)} min, ${video.views.toLocaleString()} views.
Top comments (likes in brackets):
${comments
  .slice(0, 60)
  .map((c) => `- [${c.likes}] ${c.text.replace(/\s+/g, " ").slice(0, 200)}`)
  .join("\n")}
${withTaste ? `\n${tasteBlock(taste)}\n` : ""}
Return JSON {"note": "max 2 short sentences: why this video is (or isn't) worth clipping and what kind of moments to look for",
 "moments": [{"t": seconds from start, "label": "what happens, max 8 words"}] (only moments the comments clearly point to, max 5, may be empty)${
   withTaste
     ? `,
 "fit": 0-100, how well this matches what the user liked and avoids what they disliked (50 = no signal either way),
 "fitWhy": "max 12 words, e.g. 'Same niche as the boxing interviews you liked'"`
     : ""
 }}`;
  const parsed = (await gemini(ctx, video.userId, "scout.analyze", prompt)) as {
    note?: string;
    moments?: { t?: number; label?: string }[];
    fit?: number;
    fitWhy?: string;
  } | null;
  if (!parsed) return;
  const existing = new Set(video.moments.filter((m) => m.source !== "ai").map((m) => Math.round(m.t / 20)));
  const aiMoments = (parsed.moments ?? [])
    .filter((m) => Number.isFinite(m.t) && m.t! > 0 && m.t! < video.durationSec && !existing.has(Math.round(m.t! / 20)))
    .slice(0, 5)
    .map((m) => ({ t: Math.round(m.t!), label: String(m.label ?? "").slice(0, 90), mentions: 1, source: "ai" }));
  // With a taste profile, always store a fit (50 = neutral).
  const fit = withTaste ? (Number.isFinite(parsed.fit) ? Number(parsed.fit) : 50) : undefined;
  await ctx.runMutation(internal.scout.patchVideo, {
    id: video._id,
    aiNote: String(parsed.note ?? "").slice(0, 400),
    ...(fit !== undefined ? { fit, fitWhy: String(parsed.fitWhy ?? "").slice(0, 120) } : {}),
    addMoments: aiMoments,
    replaceSource: "ai",
  });
}

async function analyzeNew(ctx: ActionCtx, userId: string, limit: number) {
  const taste: Taste = await ctx.runQuery(internal.scout.tasteProfile, { userId });
  const todo: Doc<"scoutVideos">[] = await ctx.runQuery(internal.scout.toAnalyze, { userId, minScore: 40, limit });
  for (const v of todo) {
    await ctx.runMutation(internal.scout.countAiTry, { id: v._id });
    const comments = await topComments(ctx, v.videoId);
    await analyze(ctx, v, comments, taste).catch(() => {});
  }
}

// Niche keywords to watch, from what the user liked/disliked (≈ $0.001).
export const suggestKeywords = action({
  args: { niche: v.optional(v.string()) },
  handler: async (ctx, { niche }): Promise<{ keyword: string; why: string }[]> => {
    const userId = await requireUserId(ctx);
    const taste: Taste = await ctx.runQuery(internal.scout.tasteProfile, { userId });
    const focus = niche?.trim().slice(0, 60);
    if (!focus && taste.likes.length === 0 && taste.niches.length === 0) {
      throw new Error("Pick your niches in Settings or give a few videos a 👍 first, then I can suggest keywords.");
    }
    const prompt = `You help a short-form clipper find long YouTube videos (podcasts, interviews, streams) to clip.
${tasteBlock(taste)}
Keywords they already watch: ${taste.keywords.join(", ") || "(none)"}
${focus ? `\nFocus ONLY on this niche: ${focus}\n` : ""}
Suggest 6 NEW YouTube search keywords (2–4 words each)${focus ? ` for "${focus}"` : " for the niche(s) they like"}: specific enough to find long talk videos worth clipping${taste.dislikes.length ? ", avoiding what they disliked" : ""}. Don't repeat or reword their existing keywords.
Return JSON [{"keyword": "...", "why": "max 10 words"}]`;
    const parsed = await gemini(ctx, userId, "scout.keywords", prompt);
    const have = new Set(taste.keywords.map((k) => k.toLowerCase().trim()));
    return (Array.isArray(parsed) ? parsed : [])
      .map((x: { keyword?: unknown; why?: unknown }) => ({
        keyword: String(x.keyword ?? "").trim().slice(0, 60),
        why: String(x.why ?? "").slice(0, 100),
      }))
      .filter((x) => x.keyword && !have.has(x.keyword.toLowerCase()))
      .slice(0, 6);
  },
});

async function scanMany(ctx: ActionCtx, targets: Doc<"scoutTargets">[]) {
  let found = 0;
  const users = new Set<string>();
  for (const t of targets) {
    const used: number = await ctx.runQuery(internal.scout.quotaUsed, {});
    if (used > QUOTA_SCAN_LIMIT) break;
    try {
      found += await scanTarget(ctx, t);
      await ctx.runMutation(internal.scout.markScanned, { targetId: t._id });
      users.add(t.userId);
    } catch (e) {
      await ctx.runMutation(internal.scout.markScanned, { targetId: t._id, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      if (e instanceof Error && /quota/i.test(e.message)) break;
    }
  }
  for (const u of users) await analyzeNew(ctx, u, 8);
  return found;
}

// "Scan now" for the signed-in user's targets.
export const scanNow = action({
  args: {},
  handler: async (ctx): Promise<{ found: number }> => {
    const userId = await requireUserId(ctx);
    const all: Doc<"scoutTargets">[] = await ctx.runQuery(internal.scout.userTargets, { userId });
    const targets = all.slice(0, 12);
    if (targets.length === 0) throw new Error("Add a keyword or channel first.");
    const used: number = await ctx.runQuery(internal.scout.quotaUsed, {});
    if (used > QUOTA_SCAN_LIMIT) {
      throw new Error("Today's YouTube scan budget is used up. Scans resume after midnight UTC.");
    }
    return { found: await scanMany(ctx, targets) };
  },
});

// Cron (every 30 min): scan targets that are due.
export const runDue = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    if (!process.env.YOUTUBE_API_KEY) return null;
    const due: Doc<"scoutTargets">[] = await ctx.runQuery(internal.scout.dueTargets, { limit: 8 });
    if (due.length) await scanMany(ctx, due);
    return null;
  },
});

// ── On demand ──

async function ownVideo(ctx: ActionCtx, id: Id<"scoutVideos">): Promise<Doc<"scoutVideos">> {
  const userId = await requireUserId(ctx);
  const video: Doc<"scoutVideos"> | null = await ctx.runQuery(internal.scout.videoById, { id });
  if (!video || video.userId !== userId) throw new Error("Not found");
  return video;
}

// YouTube's "most replayed" peaks via Apify (≈ $0.005 per video).
export const findMoments = action({
  args: { id: v.id("scoutVideos") },
  handler: async (ctx, { id }): Promise<number> => {
    const video = await ownVideo(ctx, id);
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error("APIFY_TOKEN is not set");
    await ctx.runMutation(internal.scout.patchVideo, { id, busy: "heatmap" });
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${HEATMAP_ACTOR}/run-sync-get-dataset-items?maxTotalChargeUsd=0.05&timeout=150`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ urls: [`https://www.youtube.com/watch?v=${video.videoId}`], maxRetries: 2 }),
        }
      );
      if (!res.ok) throw new Error(`Couldn't read the replay graph (${res.status}). Try again later.`);
      const items = (await res.json()) as {
        mostReplayed?: { visibleTimeRangeStartMillis?: number; visibleTimeRangeEndMillis?: number; decorationTimeMillis?: number }[];
        heatSeek?: { startMillis?: string; durationMillis?: string; intensityScoreNormalized?: number }[];
      }[];
      await ctx.runMutation(internal.usage.recordInternal, {
        userId: video.userId,
        provider: "apify",
        model: "most-replayed",
        feature: "scout.heatmap",
        inputTokens: 0,
        outputTokens: 1,
        costUsd: HEATMAP_USD,
      });
      const it = items[0] ?? {};
      let peaks = (it.mostReplayed ?? [])
        .map((m) => Math.round((m.decorationTimeMillis ?? m.visibleTimeRangeStartMillis ?? 0) / 1000))
        .filter((t) => t > 0);
      // No labelled peaks: take the strongest points of the curve (skip the intro).
      if (peaks.length === 0 && it.heatSeek?.length) {
        const intro = video.durationSec * 0.05;
        peaks = it.heatSeek
          .map((h) => ({ t: Math.round(Number(h.startMillis ?? 0) / 1000), s: h.intensityScoreNormalized ?? 0 }))
          .filter((h) => h.t > intro)
          .sort((a, b) => b.s - a.s)
          .slice(0, 5)
          .map((h) => h.t);
      }
      const moments = [...new Set(peaks)].slice(0, 5).map((t, i) => ({
        t,
        label: i === 0 ? "Most replayed" : "Replayed a lot",
        mentions: 5 - Math.min(4, i),
        source: "heatmap",
      }));
      await ctx.runMutation(internal.scout.patchVideo, {
        id,
        addMoments: moments,
        replaceSource: "heatmap",
        heatmapAt: Date.now(),
        busy: null,
      });
      return moments.length;
    } catch (e) {
      await ctx.runMutation(internal.scout.patchVideo, { id, busy: null });
      throw e;
    }
  },
});

// How many Shorts already clip this video (searches the title; 100 units).
export const checkCompetition = action({
  args: { id: v.id("scoutVideos") },
  handler: async (ctx, { id }): Promise<number> => {
    const video = await ownVideo(ctx, id);
    await ctx.runMutation(internal.scout.patchVideo, { id, busy: "competition" });
    try {
      const words = video.title.replace(/[|#\[\](){}"“”]/g, " ").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
      const r = await yt(
        ctx,
        "search",
        { part: "snippet", type: "video", videoDuration: "short", q: `${words} ${video.channelTitle}`, maxResults: 50, order: "relevance" },
        UNITS.search
      );
      const others = (r.items ?? []).filter((x) => x.snippet?.channelId !== video.channelId && Date.parse(x.snippet?.publishedAt ?? 0) >= video.publishedAt);
      let topViews = 0;
      if (others.length) {
        const st = await yt(ctx, "videos", { part: "statistics", id: others.map((x) => x.id?.videoId).filter(Boolean).join(",") }, UNITS.list);
        topViews = Math.max(0, ...(st.items ?? []).map((x) => Number(x.statistics?.viewCount ?? 0)));
      }
      await ctx.runMutation(internal.scout.patchVideo, {
        id,
        competition: { shorts: others.length, topViews, checkedAt: Date.now() },
        busy: null,
      });
      return others.length;
    } catch (e) {
      await ctx.runMutation(internal.scout.patchVideo, { id, busy: null });
      throw e;
    }
  },
});
