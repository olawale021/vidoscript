"use client";

import {
  Heart,
  MessageCircle,
  Play,
  Image as ImageIcon,
  Images,
} from "lucide-react";
import type { InstagramPost } from "@/types/instagram";

export function formatCount(num: number | undefined): string {
  if (num == null) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getPostImage(post: InstagramPost): string | null {
  const candidates = post.image_versions2?.candidates;
  if (candidates && candidates.length > 0) {
    return candidates[0].url;
  }
  return null;
}

function MediaTypeIcon({ type }: { type: number }) {
  if (type === 2) return <Play size={14} className="fill-current" />;
  if (type === 8) return <Images size={14} />;
  return null;
}

export function PostCard({
  post,
  onClick,
}: {
  post: InstagramPost;
  onClick: () => void;
}) {
  const imageUrl = getPostImage(post);

  return (
    <button
      onClick={onClick}
      className="group relative aspect-square bg-neutral-800 rounded-md overflow-hidden cursor-pointer border border-neutral-700 hover:border-neutral-500 transition-all"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={post.caption?.text?.slice(0, 60) || "Post"}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <ImageIcon size={24} className="text-neutral-600" />
        </div>
      )}

      {post.media_type !== 1 && (
        <div className="absolute top-2 right-2 bg-black/60 text-white rounded-sm px-1.5 py-0.5 text-sm flex items-center gap-1">
          <MediaTypeIcon type={post.media_type} />
          {post.media_type === 8 && post.carousel_media_count}
        </div>
      )}

      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white">
        <span className="flex items-center gap-1.5 text-lg font-bold">
          <Heart size={18} className="fill-current" />
          {formatCount(post.like_count)}
        </span>
        <span className="flex items-center gap-1.5 text-lg font-bold">
          <MessageCircle size={18} className="fill-current" />
          {formatCount(post.comment_count)}
        </span>
      </div>
    </button>
  );
}
