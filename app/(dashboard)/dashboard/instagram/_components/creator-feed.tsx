"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstagramFeed, InstagramPost } from "@/types/instagram";
import { PostCard } from "./post-card";
import { PostDetailModal } from "./post-detail-modal";
import { TopPerformers } from "./top-performers";

function proxyImg(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return `/api/instagram/image-proxy?url=${encodeURIComponent(url)}`;
}

interface CreatorFeedProps {
  userId: number | string; // Instagram pk
  username: string;
  fullName?: string;
  profilePicUrl?: string;
  onBack: () => void;
}

// Inline feed browser for an already-saved creator: posts grid + Top
// Performers toggle + post modal, without round-tripping through Browse Feed.
export function CreatorFeed({
  userId,
  username,
  fullName,
  profilePicUrl,
  onBack,
}: CreatorFeedProps) {
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextMaxId, setNextMaxId] = useState<string | undefined>();
  const [selectedPost, setSelectedPost] = useState<InstagramPost | null>(null);
  const [feedView, setFeedView] = useState<"all" | "top">("all");

  const fetchFeed = async (options?: { refresh?: boolean; maxId?: string }) => {
    const { refresh = false, maxId } = options || {};
    if (maxId) setLoadingMore(true);
    else if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ user_id: String(userId) });
      if (refresh) params.set("refresh", "true");
      if (maxId) params.set("next_max_id", maxId);

      const res = await fetch(`/api/instagram?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch posts");
      }
      const data: InstagramFeed = await res.json();
      setPosts(data.items || []);
      setHasMore(data.more_available ?? false);
      setNextMaxId(data.next_max_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const feedContext =
    posts.length > 0
      ? {
          avgLikes: Math.round(
            posts.reduce((s, p) => s + (p.like_count ?? 0), 0) / posts.length
          ),
          avgComments: Math.round(
            posts.reduce((s, p) => s + (p.comment_count ?? 0), 0) / posts.length
          ),
          totalPosts: posts.length,
        }
      : undefined;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6 pb-4 border-b border-neutral-700">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
          title="Back to My Creators"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="relative w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
          <span className="text-base font-bold text-neutral-500 uppercase">
            {username[0]}
          </span>
          {profilePicUrl && (
            <img
              src={proxyImg(profilePicUrl)}
              alt={username}
              onError={(e) => (e.currentTarget.style.display = "none")}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-white truncate">
            {fullName || username}
          </p>
          <p className="text-base text-neutral-400">
            @{username}
            {posts.length > 0 && ` · ${posts.length} posts loaded`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchFeed({ refresh: true })}
          disabled={refreshing || loading}
          className="border-neutral-700 text-neutral-300 hover:text-white"
        >
          <RefreshCw className={`mr-1.5 ${refreshing ? "animate-spin" : ""}`} size={14} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="border border-neutral-700 rounded-md p-3 mb-6 text-neutral-400 text-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-lg text-neutral-400 py-10">
          <Loader2 className="animate-spin" size={16} />
          Loading @{username}&apos;s posts...
        </div>
      ) : posts.length === 0 ? (
        <div className="border border-dashed border-neutral-800 rounded-lg p-10 text-center">
          <ImageIcon className="mx-auto mb-3 text-neutral-600" size={28} />
          <p className="text-lg text-neutral-400">No posts found for this creator</p>
        </div>
      ) : (
        <>
          {/* View toggle */}
          <div className="flex gap-1.5 mb-4">
            {([
              { key: "all" as const, label: "All Posts" },
              { key: "top" as const, label: "🔥 Top Performers" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFeedView(key)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                  feedView === key
                    ? "border-white bg-white/10 text-white"
                    : "border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {feedView === "top" ? (
            <TopPerformers posts={posts} onSelect={setSelectedPost} />
          ) : (
            <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
              {posts.map((post) => (
                <PostCard key={post.id} post={post} onClick={() => setSelectedPost(post)} />
              ))}
            </div>
          )}

          {hasMore && nextMaxId && (
            <div className="flex justify-center mt-6">
              <Button
                variant="outline"
                onClick={() => fetchFeed({ maxId: nextMaxId })}
                disabled={loadingMore}
                className="border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="animate-spin mr-1.5" size={14} />
                    Loading...
                  </>
                ) : (
                  "Load More"
                )}
              </Button>
            </div>
          )}
        </>
      )}

      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          feedContext={feedContext}
        />
      )}
    </div>
  );
}
