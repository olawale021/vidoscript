"use client";

import { useMemo } from "react";
import { Copy, Heart, Image as ImageIcon, MessageCircle, Play, TrendingUp } from "lucide-react";
import type { InstagramPost } from "@/types/instagram";
import { cn } from "@/lib/utils";
import { formatCount, formatDate, getPostImage } from "./post-card";

function proxyImg(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return `/api/instagram/image-proxy?url=${encodeURIComponent(url)}`;
}

// media_type: 1 = photo, 2 = reel/video, 8 = carousel
function mediaTypeBadge(post: InstagramPost): { label: string; icon: typeof Play } {
  if (post.media_type === 2) return { label: "Reel", icon: Play };
  if (post.media_type === 8)
    return {
      label: `Carousel${post.carousel_media_count ? ` · ${post.carousel_media_count}` : ""}`,
      icon: Copy,
    };
  return { label: "Photo", icon: ImageIcon };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface TopPerformersProps {
  posts: InstagramPost[];
  onSelect: (post: InstagramPost) => void;
}

// Ranks loaded posts against the creator's own baseline. Median (not mean) so
// one mega-viral post doesn't hide the other outliers; the newest 3 posts are
// excluded from the baseline because their engagement is still accruing.
export function TopPerformers({ posts, onSelect }: TopPerformersProps) {
  const { baseline, poolSize, ranked } = useMemo(() => {
    const pool = posts.length > 8 ? posts.slice(3) : posts;
    const base = median(pool.map((p) => p.like_count ?? 0));
    const rankedPosts = posts
      .map((post) => ({
        post,
        multiplier: base > 0 ? (post.like_count ?? 0) / base : 0,
      }))
      .filter((r) => r.multiplier >= 1.5)
      .sort((a, b) => b.multiplier - a.multiplier);
    return { baseline: base, poolSize: pool.length, ranked: rankedPosts };
  }, [posts]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-neutral-500">
          Baseline: median {formatCount(Math.round(baseline))} likes across {poolSize}{" "}
          posts. Posts below did <span className="text-neutral-300">1.5×+</span> that —
          proven topics worth stealing (the topic, not the content).
        </p>
      </div>

      {posts.length < 12 && (
        <p className="text-xs text-neutral-600 mb-4">
          Tip: hit &quot;Load More&quot; in All Posts first — a bigger sample makes the
          baseline (and the outliers) more trustworthy.
        </p>
      )}

      {ranked.length === 0 ? (
        <div className="border border-dashed border-neutral-800 rounded-lg p-10 text-center">
          <TrendingUp className="mx-auto mb-3 text-neutral-600" size={22} />
          <p className="text-base text-neutral-400">
            No clear outliers in the {posts.length} posts loaded
          </p>
          <p className="text-sm text-neutral-600 mt-1">
            This creator&apos;s engagement is consistent — load more posts, or try
            another profile.
          </p>
        </div>
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {ranked.map(({ post, multiplier }) => {
            const img = proxyImg(getPostImage(post));
            const hot = multiplier >= 3;
            const media = mediaTypeBadge(post);
            const MediaIcon = media.icon;
            return (
              <button
                key={post.id}
                onClick={() => onSelect(post)}
                className="w-full text-left border border-neutral-800 rounded-lg p-3 bg-neutral-950 hover:border-neutral-600 transition flex gap-3 items-start"
              >
                <div className="relative w-16 h-20 rounded-md overflow-hidden bg-neutral-900 flex-shrink-0 flex items-center justify-center">
                  {img ? (
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={16} className="text-neutral-700" />
                  )}
                  {post.media_type === 2 && (
                    <span className="absolute top-1 right-1 bg-black/70 rounded-full p-1">
                      <Play size={9} className="text-white fill-white" />
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                        hot
                          ? "bg-amber-900/40 text-amber-300 border border-amber-800"
                          : "bg-neutral-800 text-neutral-300 border border-neutral-700"
                      )}
                    >
                      <TrendingUp size={11} />
                      {multiplier.toFixed(1)}× avg
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border",
                        post.media_type === 2
                          ? "bg-violet-900/30 text-violet-300 border-violet-800"
                          : "bg-neutral-800 text-neutral-400 border-neutral-700"
                      )}
                    >
                      <MediaIcon size={10} />
                      {media.label}
                    </span>
                    <span className="text-xs text-neutral-600">
                      {formatDate(post.taken_at)}
                    </span>
                  </div>
                  {post.caption?.text && (
                    <p className="text-sm text-neutral-300 line-clamp-2">
                      {post.caption.text}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                      <Heart size={11} /> {formatCount(post.like_count)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle size={11} /> {formatCount(post.comment_count)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
