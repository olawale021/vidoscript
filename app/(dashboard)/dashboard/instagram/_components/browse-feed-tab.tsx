"use client";

import { useState, useEffect } from "react";
import { Search, Loader2, Image as ImageIcon, RefreshCw, ExternalLink, Lock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { InstagramPost, InstagramFeed, InstagramProfile } from "@/types/instagram";
import { PostCard } from "./post-card";
import { PostDetailModal } from "./post-detail-modal";
import { TopPerformers } from "./top-performers";

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function proxyImg(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return `/api/instagram/image-proxy?url=${encodeURIComponent(url)}`;
}

export function BrowseFeedTab() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 1: Profile
  const [profile, setProfile] = useState<InstagramProfile | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [togglingFav, setTogglingFav] = useState(false);

  // Phase 2: Feed
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [showFeed, setShowFeed] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextMaxId, setNextMaxId] = useState<string | undefined>();

  const [selectedPost, setSelectedPost] = useState<InstagramPost | null>(null);
  const [feedView, setFeedView] = useState<"all" | "top">("all");

  // Check favorite status when profile loads
  useEffect(() => {
    if (!profile) return;
    fetch(`/api/instagram/favorites?username=${encodeURIComponent(profile.username)}`)
      .then((r) => r.json())
      .then((d) => setIsFavorite(d.isFavorite ?? false))
      .catch(() => {});
  }, [profile?.username]);

  const toggleFavorite = async () => {
    if (!profile || togglingFav) return;
    setTogglingFav(true);
    try {
      const res = await fetch("/api/instagram/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: profile.username }),
      });
      const data = await res.json();
      setIsFavorite(data.isFavorite);
    } catch {
      // ignore
    } finally {
      setTogglingFav(false);
    }
  };

  const searchProfile = async () => {
    const trimmed = username.trim().replace(/^@/, "");
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setProfile(null);
    setShowFeed(false);
    setPosts([]);
    setHasMore(false);
    setNextMaxId(undefined);

    try {
      const res = await fetch(
        `/api/instagram/profile?username=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to find user");
      }
      const data: InstagramProfile = await res.json();
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") searchProfile();
  };

  const fetchFeed = async (options?: { refresh?: boolean; maxId?: string }) => {
    if (!profile) return;
    const { refresh = false, maxId } = options || {};

    if (maxId) {
      setLoadingMore(true);
    } else if (refresh) {
      setRefreshing(true);
    } else {
      setLoadingFeed(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({ user_id: String(profile.pk) });
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
      setShowFeed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoadingFeed(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  // Compute feed averages for post analysis context
  const feedContext = posts.length > 0
    ? (() => {
        const totalLikes = posts.reduce((s, p) => s + (p.like_count ?? 0), 0);
        const totalComments = posts.reduce((s, p) => s + (p.comment_count ?? 0), 0);
        return {
          avgLikes: Math.round(totalLikes / posts.length),
          avgComments: Math.round(totalComments / posts.length),
          totalPosts: posts.length,
        };
      })()
    : undefined;

  return (
    <div>
      {/* Search bar */}
      <div className="flex gap-2 mb-6">
        <Input
          placeholder="Enter username (e.g. nike)"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-neutral-900 border-neutral-700 text-white text-lg placeholder:text-neutral-500"
        />
        <Button onClick={searchProfile} disabled={loading || !username.trim()}>
          {loading ? (
            <Loader2 className="animate-spin mr-1.5" size={16} />
          ) : (
            <Search className="mr-1.5" size={16} />
          )}
          {loading ? "Searching..." : "Search"}
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 mb-6 text-lg text-neutral-400">
          <Loader2 className="animate-spin" size={16} />
          Looking up @{username.trim().replace(/^@/, "")}...
        </div>
      )}

      {error && (
        <div className="border border-neutral-700 rounded-md p-3 mb-6 text-neutral-400 text-lg">
          {error}
        </div>
      )}

      {/* Phase 1: Profile Card */}
      {profile && !showFeed && (
        <Card className="bg-neutral-900 border-neutral-700 mb-6">
          <CardContent className="p-6">
            <div className="flex items-start gap-5">
              <img
                src={proxyImg(profile.hd_profile_pic_url_info?.url || profile.profile_pic_url)}
                alt={profile.username}
                className="w-24 h-24 rounded-full object-cover flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-white truncate">
                    {profile.full_name || profile.username}
                  </h2>
                  {profile.is_verified && (
                    <svg className="w-5 h-5 text-blue-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  )}
                  {profile.is_private && (
                    <Lock className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                  )}
                  <button
                    onClick={toggleFavorite}
                    disabled={togglingFav}
                    className="ml-auto flex-shrink-0 p-1.5 rounded-md hover:bg-neutral-800 transition-colors"
                    title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star
                      size={20}
                      className={isFavorite ? "text-yellow-400 fill-yellow-400" : "text-neutral-500"}
                    />
                  </button>
                </div>
                <p className="text-lg text-neutral-400 font-medium mb-2">@{profile.username}</p>
                {profile.category && (
                  <p className="text-base text-neutral-500 mb-2">{profile.category}</p>
                )}
                {profile.biography && (
                  <p className="text-base text-neutral-300 whitespace-pre-line mb-3">{profile.biography}</p>
                )}
                {profile.external_url && (
                  <a
                    href={profile.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-base text-blue-400 hover:underline mb-3"
                  >
                    <ExternalLink size={14} />
                    {profile.external_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}

                {/* Stats row */}
                <div className="flex gap-6 mt-2">
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">{formatCount(profile.media_count)}</p>
                    <p className="text-sm text-neutral-500">posts</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">{formatCount(profile.follower_count)}</p>
                    <p className="text-sm text-neutral-500">followers</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-white">{formatCount(profile.following_count)}</p>
                    <p className="text-sm text-neutral-500">following</p>
                  </div>
                </div>
              </div>
            </div>

            {/* View Posts button */}
            <div className="mt-5">
              <Button
                onClick={() => fetchFeed()}
                disabled={loadingFeed || profile.is_private}
                className="w-full"
              >
                {loadingFeed ? (
                  <>
                    <Loader2 className="animate-spin mr-1.5" size={16} />
                    Loading posts...
                  </>
                ) : profile.is_private ? (
                  "Private Account"
                ) : (
                  "View Posts"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Phase 2: Feed with compact profile header */}
      {profile && showFeed && (
        <>
          {/* Compact profile header */}
          <div className="flex items-center gap-4 mb-6 pb-4 border-b border-neutral-700">
            <img
              src={proxyImg(profile.profile_pic_url)}
              alt={profile.username}
              className="w-12 h-12 rounded-full"
            />
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-white flex items-center gap-1.5">
                {profile.full_name || profile.username}
                {profile.is_verified && (
                  <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                )}
              </p>
              <p className="text-base text-neutral-400">
                {posts.length} posts loaded of {formatCount(profile.media_count)} total
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleFavorite}
                disabled={togglingFav}
                className="p-1.5 rounded-md hover:bg-neutral-800 transition-colors"
                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  size={18}
                  className={isFavorite ? "text-yellow-400 fill-yellow-400" : "text-neutral-500"}
                />
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFeed(false)}
                className="border-neutral-700 text-neutral-300 hover:text-white"
              >
                Profile
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchFeed({ refresh: true })}
                disabled={refreshing}
                className="border-neutral-700 text-neutral-300 hover:text-white"
              >
                <RefreshCw className={`mr-1.5 ${refreshing ? "animate-spin" : ""}`} size={14} />
                {refreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>

          {/* Posts grid */}
          {posts.length > 0 ? (
            <>
              {/* View toggle: chronological grid vs outlier ranking */}
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
                    <PostCard
                      key={post.id}
                      post={post}
                      onClick={() => setSelectedPost(post)}
                    />
                  ))}
                </div>
              )}

              {/* Load more */}
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
          ) : (
            <Card className="bg-neutral-900 border-neutral-700">
              <CardContent className="p-10 text-center">
                <ImageIcon className="mx-auto mb-3 text-neutral-600" size={32} />
                <p className="text-lg text-neutral-400">
                  No posts found for this user
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Loading feed indicator */}
      {loadingFeed && (
        <div className="flex items-center gap-2 mb-6 text-lg text-neutral-400">
          <Loader2 className="animate-spin" size={16} />
          Fetching posts...
        </div>
      )}

      {/* Post detail modal */}
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
