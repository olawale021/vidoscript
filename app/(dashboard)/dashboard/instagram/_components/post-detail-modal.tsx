"use client";

import { useState } from "react";
import {
  Heart,
  MessageCircle,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Feather,
  Loader2,
  CheckCircle,
  Clapperboard,
} from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import type { InstagramPost } from "@/types/instagram";
import { formatCount, formatDate, getPostImage } from "./post-card";
import { CommentsSection } from "./comments-section";
import { GenerateFromCaption } from "./generate-from-caption";
import { AnalyzePost } from "./analyze-post";
import { GenerateAngles } from "./generate-angles";

export interface FeedContext {
  avgLikes: number;
  avgComments: number;
  totalPosts: number;
}

interface PostDetailModalProps {
  post: InstagramPost;
  onClose: () => void;
  feedContext?: FeedContext;
}

export function PostDetailModal({
  post,
  onClose,
  feedContext,
}: PostDetailModalProps) {
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [styleState, setStyleState] = useState<"idle" | "adding" | "done" | "error">("idle");
  const [styleError, setStyleError] = useState<string | null>(null);
  const [libraryState, setLibraryState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const addStyleSample = useMutation(api.styleBank.add);
  const startLibraryImport = useMutation(api.library.startInstagramImport);

  const videoUrl = post.media_type === 2 ? post.video_versions?.[0]?.url : undefined;

  // Kicks off a background import (download → Convex storage); the mutation
  // returns immediately and the Library page shows live progress.
  const saveToLibrary = async () => {
    if (!videoUrl || libraryState === "saving" || libraryState === "done") return;
    setLibraryState("saving");
    setLibraryError(null);
    try {
      await startLibraryImport({
        shortcode: post.code,
        videoUrl,
        thumbnailUrl: getPostImage(post) ?? undefined,
        sourceUrl: post.code ? `https://www.instagram.com/reel/${post.code}/` : undefined,
        creatorHandle: post.user.username,
        caption: post.caption?.text ?? undefined,
        durationSec: post.video_duration,
      });
      setLibraryState("done");
    } catch (e) {
      setLibraryState("error");
      setLibraryError(e instanceof Error ? e.message : "Failed");
    }
  };

  const addToStyleBank = async () => {
    if (!videoUrl || styleState === "adding" || styleState === "done") return;
    setStyleState("adding");
    setStyleError(null);
    try {
      const res = await fetch("/api/style/ingest-instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, handle: post.user.username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to transcribe reel");
      await addStyleSample({
        source: "instagram",
        creatorHandle: post.user.username,
        title: data.title || `@${post.user.username} reel`,
        transcript: data.transcript,
        structuredTranscript: data.structuredTranscript ?? null,
        themes: data.themes ?? [],
        hook: data.hook ?? null,
      });
      setStyleState("done");
    } catch (e) {
      setStyleState("error");
      setStyleError(e instanceof Error ? e.message : "Failed");
    }
  };

  const getDisplayImage = () => {
    if (post.media_type === 8 && post.carousel_media) {
      const item = post.carousel_media[carouselIndex];
      const candidates = item?.image_versions2?.candidates;
      if (candidates && candidates.length > 0) return candidates[0].url;
    }
    return getPostImage(post);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-neutral-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row border border-neutral-700">
        {/* Image side */}
        <div className="relative bg-neutral-950 md:w-1/2 aspect-square flex-shrink-0">
          {post.media_type === 2 && post.video_versions?.[0] ? (
            <video
              src={post.video_versions[0].url}
              controls
              className="w-full h-full object-contain"
            />
          ) : (
            <>
              {getDisplayImage() ? (
                <img
                  src={getDisplayImage()!}
                  alt=""
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon size={32} className="text-neutral-600" />
                </div>
              )}
            </>
          )}

          {/* Carousel nav */}
          {post.media_type === 8 &&
            post.carousel_media &&
            post.carousel_media.length > 1 && (
              <>
                {carouselIndex > 0 && (
                  <button
                    onClick={() => setCarouselIndex((i) => i - 1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition"
                  >
                    <ChevronLeft size={18} />
                  </button>
                )}
                {carouselIndex < post.carousel_media.length - 1 && (
                  <button
                    onClick={() => setCarouselIndex((i) => i + 1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition"
                  >
                    <ChevronRight size={18} />
                  </button>
                )}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                  {post.carousel_media.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-1.5 h-1.5 rounded-full transition",
                        i === carouselIndex ? "bg-white" : "bg-white/40"
                      )}
                    />
                  ))}
                </div>
              </>
            )}
        </div>

        {/* Info side */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-neutral-700">
            <div className="flex items-center gap-3">
              <img
                src={post.user.profile_pic_url}
                alt={post.user.username}
                className="w-10 h-10 rounded-full"
              />
              <div>
                <p className="text-lg font-bold text-white flex items-center gap-1">
                  {post.user.username}
                  {post.user.is_verified && (
                    <svg
                      className="w-4 h-4 text-blue-400"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  )}
                </p>
                <p className="text-base text-neutral-500 font-medium">
                  {formatDate(post.taken_at)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-neutral-500 hover:text-white text-3xl leading-none px-2"
            >
              &times;
            </button>
          </div>

          {/* Caption + actions + comments */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {post.caption?.text && (
              <p className="text-lg text-neutral-300 leading-relaxed whitespace-pre-wrap">
                {post.caption.text}
              </p>
            )}

            {/* Action buttons row */}
            <div className="flex gap-2 flex-wrap">
              {/* Analyze Post */}
              <AnalyzePost post={post} feedContext={feedContext} />

              {/* Generate original angles from this post's topic */}
              {post.caption?.text && (
                <GenerateAngles
                  post={post}
                  multiplier={
                    feedContext && feedContext.avgLikes > 0
                      ? post.like_count / feedContext.avgLikes
                      : undefined
                  }
                />
              )}

              {/* Generate Script from Caption */}
              {post.caption?.text && (
                <GenerateFromCaption caption={post.caption.text} />
              )}

              {/* Add reel to Style Bank */}
              {videoUrl && (
                <button
                  onClick={addToStyleBank}
                  disabled={styleState === "adding" || styleState === "done"}
                  title={`Transcribe this reel and learn @${post.user.username}'s writing style`}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition",
                    styleState === "done"
                      ? "border-emerald-800 bg-emerald-900/30 text-emerald-300"
                      : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-500"
                  )}
                >
                  {styleState === "adding" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : styleState === "done" ? (
                    <CheckCircle size={13} />
                  ) : (
                    <Feather size={13} />
                  )}
                  {styleState === "adding"
                    ? "Transcribing..."
                    : styleState === "done"
                    ? "In Style Bank"
                    : "Add to Style Bank"}
                </button>
              )}
              {styleState === "error" && styleError && (
                <span className="text-xs text-red-400 self-center">{styleError}</span>
              )}

              {/* Save reel to Library (background download → Convex storage) */}
              {videoUrl && (
                <button
                  onClick={saveToLibrary}
                  disabled={libraryState === "saving" || libraryState === "done"}
                  title="Download this reel into your Library so you can script from it later"
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition",
                    libraryState === "done"
                      ? "border-emerald-800 bg-emerald-900/30 text-emerald-300"
                      : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-500"
                  )}
                >
                  {libraryState === "saving" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : libraryState === "done" ? (
                    <CheckCircle size={13} />
                  ) : (
                    <Clapperboard size={13} />
                  )}
                  {libraryState === "saving"
                    ? "Saving..."
                    : libraryState === "done"
                    ? "In Library"
                    : "Save to Library"}
                </button>
              )}
              {libraryState === "error" && libraryError && (
                <span className="text-xs text-red-400 self-center">{libraryError}</span>
              )}
            </div>

            {/* Comments (lazy-loaded) */}
            {post.comment_count > 0 && (
              <div className="pt-2 border-t border-neutral-800">
                <CommentsSection mediaId={post.id} />
              </div>
            )}
          </div>

          {/* Stats footer */}
          <div className="p-4 border-t border-neutral-700">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-lg font-semibold text-neutral-300">
                <Heart size={18} />
                {formatCount(post.like_count)} likes
              </span>
              <span className="flex items-center gap-1.5 text-lg font-semibold text-neutral-300">
                <MessageCircle size={18} />
                {formatCount(post.comment_count)} comments
              </span>
              {post.media_type === 2 && post.video_duration && (
                <span className="text-lg text-neutral-500 font-medium">
                  {Math.floor(post.video_duration)}s
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
