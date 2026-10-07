"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Node runtime: reels can be large and the download is buffered in memory,
// which the default V8 runtime's heap limit can't accommodate.

const RAPIDAPI_HOST = "instagram-best-experience.p.rapidapi.com";
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // matches the app-wide upload limit

// Background import: resolve the post (if only a shortcode is known), download
// the video + thumbnail from Instagram's CDN, persist to Convex storage, and
// flip the library row to ready/failed.
export const importInstagramVideo = internalAction({
  args: {
    itemId: v.id("libraryItems"),
    shortcode: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, { itemId, shortcode, videoUrl, thumbnailUrl }) => {
    try {
      let creatorHandle: string | undefined;
      let caption: string | undefined;
      let durationSec: number | undefined;

      // Always resolve fresh when we have a shortcode and no URL — IG CDN
      // URLs are signed and expire within hours.
      if (!videoUrl) {
        if (!shortcode) throw new Error("Missing video link");
        const key = process.env.RAPIDAPI_KEY;
        if (!key) {
          throw new Error(
            "RAPIDAPI_KEY is not set in the Convex deployment (npx convex env set RAPIDAPI_KEY ...)"
          );
        }
        const res = await fetch(
          `https://${RAPIDAPI_HOST}/post?shortcode=${encodeURIComponent(shortcode)}`,
          { headers: { "x-rapidapi-key": key, "x-rapidapi-host": RAPIDAPI_HOST } }
        );
        if (!res.ok) {
          throw new Error(
            `Instagram lookup failed (${res.status}) — the post may be private or deleted`
          );
        }
        const post = (await res.json()) as {
          video_versions?: { url: string }[];
          image_versions2?: { candidates?: { url: string }[] };
          user?: { username?: string };
          caption?: { text?: string } | null;
          video_duration?: number;
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
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: videoRes.headers.get("content-type") ?? "video/mp4" })
      );

      // Thumbnail is a nice-to-have — never fail the import over it.
      let thumbnailStorageId;
      if (thumbnailUrl) {
        try {
          const thumbRes = await fetch(thumbnailUrl);
          if (thumbRes.ok) {
            thumbnailStorageId = await ctx.storage.store(await thumbRes.blob());
          }
        } catch {
          // ignore
        }
      }

      await ctx.runMutation(internal.library.markReady, {
        id: itemId,
        storageId,
        thumbnailStorageId,
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
