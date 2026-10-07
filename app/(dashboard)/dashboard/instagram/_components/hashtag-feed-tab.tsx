"use client";

import { useState } from "react";
import { Hash, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InstagramPost, HashtagFeedResponse } from "@/types/instagram";
import { PostCard } from "./post-card";
import { PostDetailModal } from "./post-detail-modal";

const SECTIONS = ["top", "recent", "clips"] as const;
type Section = (typeof SECTIONS)[number];

function flattenHashtagPosts(data: HashtagFeedResponse): InstagramPost[] {
  const posts: InstagramPost[] = [];
  for (const section of data.sections ?? []) {
    const medias = section?.layout_content?.medias ?? [];
    for (const item of medias) {
      if (item?.media) posts.push(item.media);
    }
  }
  return posts;
}

export function HashtagFeedTab() {
  const [hashtag, setHashtag] = useState("");
  const [section, setSection] = useState<Section>("top");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pagination, setPagination] = useState<{
    max_id: string;
    page: string;
    rank_token: string;
  } | null>(null);
  const [selectedPost, setSelectedPost] = useState<InstagramPost | null>(null);
  const [searched, setSearched] = useState(false);

  const fetchHashtag = async (
    tag: string,
    sec: Section,
    pag?: { max_id: string; page: string; rank_token: string }
  ) => {
    const isLoadMore = !!pag;
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setPosts([]);
      setSearched(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({ tag, section: sec });
      if (pag) {
        params.set("max_id", pag.max_id);
        params.set("page", pag.page);
        params.set("rank_token", pag.rank_token);
      }

      const res = await fetch(`/api/instagram/hashtag?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch hashtag feed");
      }

      const data: HashtagFeedResponse = await res.json();
      const newPosts = flattenHashtagPosts(data);

      setPosts((prev) => (isLoadMore ? [...prev, ...newPosts] : newPosts));
      setHasMore(data.more_available ?? false);

      if (data.next_max_id && data.rank_token) {
        setPagination({
          max_id: data.next_max_id,
          page: String(data.next_page ?? 1),
          rank_token: data.rank_token,
        });
      } else {
        setPagination(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleSearch = () => {
    const tag = hashtag.trim().replace(/^#/, "");
    if (!tag) return;
    fetchHashtag(tag, section);
  };

  const handleSectionChange = (sec: Section) => {
    setSection(sec);
    const tag = hashtag.trim().replace(/^#/, "");
    if (tag && searched) {
      fetchHashtag(tag, sec);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div>
      {/* Search + section toggle */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Enter hashtag (e.g. fitness)"
          value={hashtag}
          onChange={(e) => setHashtag(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-neutral-900 border-neutral-700 text-white text-lg placeholder:text-neutral-500"
        />
        <Button
          onClick={handleSearch}
          disabled={loading || !hashtag.trim()}
        >
          {loading ? (
            <Loader2 className="animate-spin mr-1.5" size={16} />
          ) : (
            <Hash className="mr-1.5" size={16} />
          )}
          {loading ? "Fetching..." : "Search"}
        </Button>
      </div>

      {/* Section toggle */}
      <div className="flex gap-1 mb-6">
        {SECTIONS.map((sec) => (
          <button
            key={sec}
            onClick={() => handleSectionChange(sec)}
            className={cn(
              "px-3 py-1.5 text-base font-semibold rounded-md transition-colors capitalize",
              section === sec
                ? "bg-white text-neutral-900"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            )}
          >
            {sec}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 mb-6 text-lg text-neutral-400">
          <Loader2 className="animate-spin" size={16} />
          Searching #{hashtag.trim().replace(/^#/, "")}...
        </div>
      )}

      {error && (
        <div className="border border-neutral-700 rounded-md p-3 mb-6 text-neutral-400 text-lg">
          {error}
        </div>
      )}

      {/* Posts grid */}
      {posts.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onClick={() => setSelectedPost(post)}
              />
            ))}
          </div>

          {/* Load more */}
          {hasMore && pagination && (
            <div className="flex justify-center mt-6">
              <Button
                variant="outline"
                onClick={() =>
                  fetchHashtag(
                    hashtag.trim().replace(/^#/, ""),
                    section,
                    pagination
                  )
                }
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

      {/* Empty state */}
      {searched && !loading && posts.length === 0 && !error && (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-10 text-center">
            <ImageIcon className="mx-auto mb-3 text-neutral-600" size={32} />
            <p className="text-lg text-neutral-400">
              No posts found for this hashtag
            </p>
          </CardContent>
        </Card>
      )}

      {/* Post detail modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
        />
      )}
    </div>
  );
}
