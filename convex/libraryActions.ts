"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { r2, storagePrefix } from "./r2";

// Node runtime: reels can be large and the download is buffered in memory,
// which the default V8 runtime's heap limit can't accommodate.

// Apify Instagram Post Scraper (replaces RapidAPI). ≈ $0.0027 per post on the free tier.
const APIFY_POST_ACTOR = "apify~instagram-post-scraper";
const APIFY_PRICE_PER_RESULT = 0.0027;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // matches the app-wide upload limit

// Background import: resolve the post (if only a shortcode is known), download
// the video + thumbnail from Instagram's CDN, persist to Convex storage, and
// flip the library row to ready/failed.
export const importInstagramVideo = internalAction({
  args: {
    itemId: v.id("libraryItems"),
    userId: v.optional(v.string()), // for the admin cost page
    shortcode: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, { itemId, userId, shortcode, videoUrl, thumbnailUrl }) => {
    try {
      let creatorHandle: string | undefined;
      let caption: string | undefined;
      let durationSec: number | undefined;

      // Always resolve fresh when we have a shortcode and no URL — IG CDN
      // URLs are signed and expire within hours.
      if (!videoUrl) {
        if (!shortcode) throw new Error("Missing video link");
        const token = process.env.APIFY_TOKEN;
        if (!token) {
          throw new Error("APIFY_TOKEN is not set in the Convex deployment (npx convex env set APIFY_TOKEN ...)");
        }
        const res = await fetch(
          `https://api.apify.com/v2/acts/${APIFY_POST_ACTOR}/run-sync-get-dataset-items?timeout=120`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              username: [`https://www.instagram.com/p/${encodeURIComponent(shortcode)}/`],
              resultsLimit: 1,
            }),
          }
        );
        if (!res.ok) {
          throw new Error(`Instagram lookup failed (${res.status}) — try again in a minute`);
        }
        const items = (await res.json()) as {
          error?: string;
          videoUrl?: string;
          displayUrl?: string;
          ownerUsername?: string;
          caption?: string | null;
          videoDuration?: number;
        }[];
        await ctx.runMutation(internal.usage.recordInternal, {
          userId: userId ?? "anonymous",
          provider: "apify",
          model: "instagram-post-scraper",
          feature: "library.importInstagram",
          inputTokens: 0,
          outputTokens: items.length,
          costUsd: items.length * APIFY_PRICE_PER_RESULT,
        });
        const found = items.find((i) => !i.error);
        if (!found) throw new Error("Instagram post not found — it may be private or deleted");
        const post = {
          video_versions: found.videoUrl ? [{ url: found.videoUrl }] : undefined,
          image_versions2: { candidates: found.displayUrl ? [{ url: found.displayUrl }] : [] },
          user: { username: found.ownerUsername },
          caption: found.caption ? { text: found.caption } : null,
          video_duration: found.videoDuration,
        };
        videoUrl = post.video_versions?.[0]?.url;
        if (!videoUrl) {
          throw new Error("This post has no video — it may be an image or carousel");
        }
        thumbnailUrl = thumbnailUrl ?? post.image_versions2?.candidates?.[0]?.url;
        creatorHandle = post.user?.username;
        caption = post.caption?.text ?? undefined;
        durationSec = post.video_duration;
      }

      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        throw new Error(
          `Could not download the video (${videoRes.status}) — the link may have expired`
        );
      }
      const bytes = await videoRes.arrayBuffer();
      if (bytes.byteLength > MAX_VIDEO_BYTES) {
        throw new Error("Video is too large (over 300MB)");
      }
      const base = `${storagePrefix()}/library/${userId ?? "unknown"}/${itemId}`;
      const videoKey = await r2.store(ctx, new Uint8Array(bytes), {
        key: `${base}/video.mp4`,
        type: videoRes.headers.get("content-type") ?? "video/mp4",
      });

      // Thumbnail is a nice-to-have — never fail the import over it.
      let thumbnailKey: string | undefined;
      if (thumbnailUrl) {
        try {
          const thumbRes = await fetch(thumbnailUrl);
          if (thumbRes.ok) {
            thumbnailKey = await r2.store(ctx, new Uint8Array(await thumbRes.arrayBuffer()), {
              key: `${base}/thumb.jpg`,
              type: thumbRes.headers.get("content-type") ?? "image/jpeg",
            });
          }
        } catch {
          // ignore
        }
      }

      await ctx.runMutation(internal.library.markReady, {
        id: itemId,
        videoKey,
        thumbnailKey,
        fileSizeBytes: bytes.byteLength,
        creatorHandle,
        caption,
        durationSec,
      });
    } catch (e) {
      await ctx.runMutation(internal.library.markFailed, {
        id: itemId,
        error: e instanceof Error ? e.message : "Import failed",
      });
    }
  },
});
