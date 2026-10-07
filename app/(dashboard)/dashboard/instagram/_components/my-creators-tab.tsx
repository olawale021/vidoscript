"use client";

import { useState, useEffect } from "react";
import { Loader2, Star, TrendingUp, Image as ImageIcon, Trash2, RefreshCw, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { InstagramPost, InstagramProfile } from "@/types/instagram";
import { PostCard } from "./post-card";
import { PostDetailModal } from "./post-detail-modal";
import { CreatorFeed } from "./creator-feed";

interface FavoriteCreator extends InstagramProfile {
  added_at: string;
  cached_post_count: number;
}

interface Recommendation {
  postIndex: number;
  viralScore: number;
  whyItWentViral: string;
  recreationBrief: string;
  suggestedHook: string;
  post?: InstagramPost;
}

interface Topic {
  name: string;
  description: string;
  recommendations: Recommendation[];
}

interface ScoutResult {
  topics: Topic[];
  overallInsight: string;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function proxyImg(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return `/api/instagram/image-proxy?url=${encodeURIComponent(url)}`;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-green-400 border-green-400/30 bg-green-400/10"
    : score >= 60 ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/10"
    : "text-neutral-400 border-neutral-700 bg-neutral-800";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${color}`}>
      {score}
    </span>
  );
}

function TopicSection({ topic, onPostClick }: { topic: Topic; onPostClick: (post: InstagramPost) => void }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left mb-3 group"
      >
        {expanded ? <ChevronDown size={16} className="text-neutral-400" /> : <ChevronRight size={16} className="text-neutral-400" />}
        <h3 className="text-lg font-bold text-white group-hover:text-neutral-200">{topic.name}</h3>
        <span className="text-sm text-neutral-500 ml-1">({topic.recommendations.length} posts)</span>
      </button>
      {expanded && (
        <>
          <p className="text-base text-neutral-400 mb-4 ml-6">{topic.description}</p>
          <div className="space-y-4 ml-6">
            {topic.recommendations.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} onPostClick={onPostClick} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecommendationCard({ rec, onPostClick }: { rec: Recommendation; onPostClick: (post: InstagramPost) => void }) {
  const post = rec.post;
  if (!post) return null;

  const thumb = post.image_versions2?.candidates?.[0]?.url;

  return (
    <div className="flex gap-4 p-4 rounded-lg bg-neutral-900 border border-neutral-800">
      {/* Post thumbnail */}
      {thumb && (
        <button
          onClick={() => onPostClick(post)}
          className="flex-shrink-0 w-28 h-28 rounded-md overflow-hidden hover:opacity-80 transition-opacity"
        >
          <img
            src={proxyImg(thumb)}
            alt=""
            className="w-full h-full object-cover"
          />
        </button>
      )}

      {/* Brief */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <ScoreBadge score={rec.viralScore} />
          <span className="text-sm text-neutral-500">
            @{post.user?.username} &middot; {formatCount(post.like_count ?? 0)} likes
          </span>
        </div>

        <p className="text-sm text-neutral-300 mb-2">
          <span className="text-neutral-500 font-medium">Why it went viral: </span>
          {rec.whyItWentViral}
        </p>

        <p className="text-sm text-neutral-300 mb-2">
          <span className="text-neutral-500 font-medium">Recreation brief: </span>
          {rec.recreationBrief}
        </p>

        <div className="flex items-start gap-1.5 bg-neutral-800 rounded-md px-3 py-2">
          <Sparkles size={14} className="text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-yellow-200/80 italic">
            &ldquo;{rec.suggestedHook}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

export function MyCreatorsTab() {
  const [creators, setCreators] = useState<FavoriteCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scout mode
  const [scoutResult, setScoutResult] = useState<ScoutResult | null>(null);
  const [loadingScout, setLoadingScout] = useState(false);

  const [selectedPost, setSelectedPost] = useState<InstagramPost | null>(null);
  const [removingUser, setRemovingUser] = useState<string | null>(null);
  const [viewingCreator, setViewingCreator] = useState<FavoriteCreator | null>(null);

  const fetchCreators = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/favorites");
      if (!res.ok) throw new Error("Failed to load favorites");
      const data = await res.json();
      setCreators(data.creators || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCreators();
  }, []);

  const removeFavorite = async (username: string) => {
    setRemovingUser(username);
    try {
      await fetch("/api/instagram/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      setCreators((prev) => prev.filter((c) => c.username !== username));
    } catch {
      // ignore
    } finally {
      setRemovingUser(null);
    }
  };

  const scoutTopPosts = async () => {
    setLoadingScout(true);
    setError(null);
    try {
      const res = await fetch("/api/instagram/scout?limit=30");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to scout");
      }
      const data: ScoutResult = await res.json();
      setScoutResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoadingScout(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-lg text-neutral-400 py-10">
        <Loader2 className="animate-spin" size={16} />
        Loading your creators...
      </div>
    );
  }

  if (creators.length === 0 && !loading) {
    return (
      <Card className="bg-neutral-900 border-neutral-700">
        <CardContent className="p-10 text-center">
          <Star className="mx-auto mb-3 text-neutral-600" size={32} />
          <p className="text-lg text-neutral-400 mb-2">No favorite creators yet</p>
          <p className="text-base text-neutral-500">
            Search for creators in the Browse Feed tab and click the star to save them here
          </p>
        </CardContent>
      </Card>
    );
  }

  // Drill into a saved creator's feed (full Phase 2 surface: All Posts /
  // Top Performers + the post modal with angles, library, style bank).
  if (viewingCreator) {
    return (
      <CreatorFeed
        userId={viewingCreator.pk}
        username={viewingCreator.username}
        fullName={viewingCreator.full_name}
        profilePicUrl={viewingCreator.profile_pic_url}
        onBack={() => setViewingCreator(null)}
      />
    );
  }

  return (
    <div>
      {error && (
        <div className="border border-neutral-700 rounded-md p-3 mb-6 text-neutral-400 text-lg">
          {error}
        </div>
      )}

      {/* Header with Scout button */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-lg text-neutral-400">
          {creators.length} creator{creators.length !== 1 ? "s" : ""} saved
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCreators}
            className="border-neutral-700 text-neutral-300 hover:text-white"
          >
            <RefreshCw size={14} className="mr-1.5" />
            Refresh
          </Button>
          <Button
            onClick={scoutTopPosts}
            disabled={loadingScout}
            size="sm"
          >
            {loadingScout ? (
              <Loader2 className="animate-spin mr-1.5" size={14} />
            ) : (
              <TrendingUp className="mr-1.5" size={14} />
            )}
            {loadingScout ? "Analyzing..." : "Scout Viral Content"}
          </Button>
        </div>
      </div>

      {/* Creator cards */}
      <div className="grid grid-cols-1 gap-3 mb-8">
        {creators.map((creator) => (
          <div
            key={creator.username}
            className="flex items-center gap-4 p-4 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-600 transition cursor-pointer group"
            onClick={() => setViewingCreator(creator)}
            title={`View @${creator.username}'s posts`}
          >
            <div className="relative w-14 h-14 rounded-full bg-neutral-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
              <span className="text-lg font-bold text-neutral-500 uppercase">
                {creator.username[0]}
              </span>
              {creator.profile_pic_url && (
                <img
                  src={proxyImg(creator.profile_pic_url)}
                  alt={creator.username}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-base font-bold text-white truncate">
                  {creator.full_name || creator.username}
                </p>
                {creator.is_verified && (
                  <svg className="w-4 h-4 text-blue-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                )}
              </div>
              <p className="text-sm text-neutral-400">@{creator.username}</p>
            </div>
            <div className="flex items-center gap-4 text-sm text-neutral-400 flex-shrink-0">
              <span>{formatCount(creator.follower_count)} followers</span>
              <span>{creator.cached_post_count} posts cached</span>
            </div>
            <ChevronRight
              size={16}
              className="text-neutral-600 group-hover:text-white transition flex-shrink-0"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeFavorite(creator.username);
              }}
              disabled={removingUser === creator.username}
              className="p-2 rounded-md hover:bg-neutral-800 transition-colors text-neutral-500 hover:text-red-400 flex-shrink-0"
              title="Remove from favorites"
            >
              {removingUser === creator.username ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Trash2 size={16} />
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Loading scout */}
      {loadingScout && (
        <div className="border-t border-neutral-700 pt-6">
          <div className="flex items-center gap-2 text-lg text-neutral-400 py-6">
            <Loader2 className="animate-spin" size={16} />
            Analyzing top posts across your creators... this takes ~15 seconds
          </div>
        </div>
      )}

      {/* Scout results */}
      {scoutResult && !loadingScout && (
        <div className="border-t border-neutral-700 pt-6">
          {/* Overall insight */}
          {scoutResult.overallInsight && (
            <div className="flex items-start gap-3 mb-6 p-4 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
              <TrendingUp size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-yellow-400 mb-1">Key Insight</p>
                <p className="text-base text-neutral-300">{scoutResult.overallInsight}</p>
              </div>
            </div>
          )}

          {/* Topics */}
          {scoutResult.topics?.length > 0 ? (
            scoutResult.topics.map((topic, i) => (
              <TopicSection
                key={i}
                topic={topic}
                onPostClick={(post) => setSelectedPost(post)}
              />
            ))
          ) : (
            <Card className="bg-neutral-900 border-neutral-700">
              <CardContent className="p-10 text-center">
                <ImageIcon className="mx-auto mb-3 text-neutral-600" size={32} />
                <p className="text-lg text-neutral-400 mb-2">No cached posts to analyze</p>
                <p className="text-base text-neutral-500">
                  Go to Browse Feed, open each creator&apos;s posts, and load their feed first.
                  Then come back here to scout.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
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
