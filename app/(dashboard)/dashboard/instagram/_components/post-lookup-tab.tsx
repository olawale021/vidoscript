"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InstagramPost } from "@/types/instagram";
import { PostCard } from "./post-card";
import { PostDetailModal } from "./post-detail-modal";

const SHORTCODE_REGEX =
  /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;

function extractShortcode(input: string): string | null {
  const trimmed = input.trim();

  // Try URL match first
  const match = trimmed.match(SHORTCODE_REGEX);
  if (match) return match[1];

  // Bare shortcode (no slashes, no spaces)
  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length >= 6) {
    return trimmed;
  }

  return null;
}

export function PostLookupTab() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<InstagramPost | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchPost = async () => {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
      setError("Could not extract a shortcode. Paste an Instagram post URL or a raw shortcode.");
      return;
    }

    setLoading(true);
    setError(null);
    setPost(null);

    try {
      const res = await fetch(
        `/api/instagram/post?shortcode=${encodeURIComponent(shortcode)}`
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch post");
      }
      const data: InstagramPost = await res.json();
      setPost(data);
      setDetailOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") fetchPost();
  };

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <Input
          placeholder="Paste Instagram URL or shortcode (e.g. B9KI0D2HHe7)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-neutral-900 border-neutral-700 text-white text-lg placeholder:text-neutral-500"
        />
        <Button onClick={fetchPost} disabled={loading || !url.trim()}>
          {loading ? (
            <Loader2 className="animate-spin mr-1.5" size={16} />
          ) : (
            <Link2 className="mr-1.5" size={16} />
          )}
          {loading ? "Fetching..." : "Look Up"}
        </Button>
      </div>

      {error && (
        <div className="border border-neutral-700 rounded-md p-3 mb-6 text-neutral-400 text-lg">
          {error}
        </div>
      )}

      {post && !detailOpen && (
        <div className="max-w-xs">
          <PostCard post={post} onClick={() => setDetailOpen(true)} />
        </div>
      )}

      {post && detailOpen && (
        <PostDetailModal post={post} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  );
}
