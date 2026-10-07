"use client";

import { useState } from "react";
import { Loader2, Heart, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstagramComment } from "@/types/instagram";
import { formatCount, formatDate } from "./post-card";

interface CommentsSectionProps {
  mediaId: string;
}

export function CommentsSection({ mediaId }: CommentsSectionProps) {
  const [comments, setComments] = useState<InstagramComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextMinId, setNextMinId] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  const fetchComments = async (minId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ id: mediaId });
      if (minId) params.set("next_min_id", minId);

      const res = await fetch(`/api/instagram/comments?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch comments");
      }

      const data = await res.json();
      const newComments: InstagramComment[] = data.comments || [];

      setComments((prev) => (minId ? [...prev, ...newComments] : newComments));
      setNextMinId(data.next_min_id);
      setHasMore(data.has_more_comments ?? false);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (!loaded && !loading) {
    return (
      <button
        onClick={() => fetchComments()}
        className="text-base font-medium text-neutral-400 hover:text-white transition flex items-center gap-1.5"
      >
        <ChevronDown size={14} />
        View Comments
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-base font-semibold text-neutral-500 uppercase tracking-wider">
        Comments
      </p>

      {error && (
        <p className="text-base text-red-400">{error}</p>
      )}

      {loading && comments.length === 0 && (
        <div className="flex items-center gap-2 text-base text-neutral-500 py-2">
          <Loader2 className="animate-spin" size={14} />
          Loading comments...
        </div>
      )}

      <div className="space-y-3 max-h-60 overflow-y-auto">
        {comments.map((comment) => (
          <div key={comment.pk} className="flex gap-2.5">
            <img
              src={comment.user.profile_pic_url}
              alt={comment.user.username}
              className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-base font-semibold text-white flex items-center gap-0.5">
                  {comment.user.username}
                  {comment.user.is_verified && (
                    <svg
                      className="w-3 h-3 text-blue-400 inline"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  )}
                </span>
                <span className="text-sm text-neutral-500 font-medium">
                  {formatDate(comment.created_at)}
                </span>
              </div>
              <p className="text-base text-neutral-400 leading-relaxed mt-0.5">
                {comment.text}
              </p>
              {comment.comment_like_count > 0 && (
                <span className="flex items-center gap-0.5 text-sm text-neutral-500 font-medium mt-1">
                  <Heart size={10} />
                  {formatCount(comment.comment_like_count)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchComments(nextMinId)}
          disabled={loading}
          className="text-base font-medium h-8 text-neutral-400 hover:text-white"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin mr-1" size={12} />
              Loading...
            </>
          ) : (
            "Load more comments"
          )}
        </Button>
      )}

      {loaded && comments.length === 0 && !error && (
        <p className="text-base text-neutral-500">No comments yet</p>
      )}
    </div>
  );
}
