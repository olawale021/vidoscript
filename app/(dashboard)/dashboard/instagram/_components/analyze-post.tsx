"use client";

import { useState } from "react";
import {
  BarChart3,
  Loader2,
  TrendingUp,
  TrendingDown,
  Zap,
  Lightbulb,
  MessageSquareText,
  Target,
  Repeat,
  ChevronDown,
  ChevronUp,
  Film,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InstagramPost } from "@/types/instagram";

interface FeedContext {
  avgLikes: number;
  avgComments: number;
  totalPosts: number;
}

interface AnalyzePostProps {
  post: InstagramPost;
  feedContext?: FeedContext;
}

interface PostAnalysis {
  performanceRating: number;
  performanceLabel: string;
  whyItWorked: string[];
  captionBreakdown: {
    hook: string;
    bodyAnalysis: string;
    ctaPresence: string;
    hashtagStrategy: string;
    emojiUsage: string;
    length: string;
  };
  scriptBreakdown?: {
    hook: string;
    delivery: string;
    structure: string;
    retention: string;
    keyMoments: string[];
  };
  formatAnalysis: string;
  engagementBreakdown: {
    likeToCommentRatio: number;
    commentQuality: string;
    viralPotential: number;
  };
  improvements: string[];
  repostStrategy: string;
  keyTakeaway: string;
  hasTranscript?: boolean;
}

function RatingBadge({ rating, label }: { rating: number; label: string }) {
  const color =
    label === "viral"
      ? "text-green-400 bg-green-400/10 border-green-400/30"
      : label === "above_average"
        ? "text-blue-400 bg-blue-400/10 border-blue-400/30"
        : label === "average"
          ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/30"
          : "text-red-400 bg-red-400/10 border-red-400/30";

  const labelText =
    label === "viral"
      ? "Viral"
      : label === "above_average"
        ? "Above Average"
        : label === "average"
          ? "Average"
          : "Below Average";

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-neutral-800"
          />
          <circle
            cx="28"
            cy="28"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray={`${(rating / 100) * 150.8} 150.8`}
            strokeLinecap="round"
            className={
              label === "viral"
                ? "text-green-400"
                : label === "above_average"
                  ? "text-blue-400"
                  : label === "average"
                    ? "text-yellow-400"
                    : "text-red-400"
            }
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">
          {rating}
        </span>
      </div>
      <div>
        <span
          className={cn(
            "text-sm font-bold uppercase tracking-wider px-2 py-0.5 rounded border",
            color
          )}
        >
          {labelText}
        </span>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={16} className="text-neutral-500" />
      <h4 className="text-base font-bold text-white uppercase tracking-wider">
        {title}
      </h4>
    </div>
  );
}

export function AnalyzePost({ post, feedContext }: AnalyzePostProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PostAnalysis | null>(null);
  const [expanded, setExpanded] = useState(true);

  const analyze = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/instagram/analyze-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          post: {
            ...post,
            video_url: post.video_versions?.[0]?.url || null,
          },
          feedContext,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Analysis failed");
      }

      const data = await res.json();
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (!analysis) {
    return (
      <div className="pt-2">
        <Button
          onClick={analyze}
          disabled={loading}
          size="sm"
          variant="outline"
          className="text-base font-semibold h-8 gap-1.5 border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              {post.media_type === 2
                ? "Transcribing & analyzing..."
                : "Analyzing post..."}
            </>
          ) : (
            <>
              <BarChart3 size={14} />
              Analyze Post
            </>
          )}
        </Button>
        {error && <p className="text-base text-red-400 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 border border-neutral-700 rounded-md overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 bg-neutral-800 border-b border-neutral-700 hover:bg-neutral-750 transition"
      >
        <span className="text-base font-bold text-white flex items-center gap-2">
          <BarChart3 size={14} />
          Post Analysis
        </span>
        {expanded ? (
          <ChevronUp size={14} className="text-neutral-400" />
        ) : (
          <ChevronDown size={14} className="text-neutral-400" />
        )}
      </button>

      {expanded && (
        <div className="p-4 space-y-5 bg-neutral-900/50">
          {/* Rating + Key Takeaway */}
          <div className="flex items-start justify-between gap-4">
            <RatingBadge
              rating={analysis.performanceRating}
              label={analysis.performanceLabel}
            />
            <p className="text-base text-neutral-300 italic flex-1 leading-relaxed">
              &ldquo;{analysis.keyTakeaway}&rdquo;
            </p>
          </div>

          {/* Why It Worked / Didn't */}
          <div>
            <SectionHeader
              icon={
                analysis.performanceLabel === "below_average"
                  ? TrendingDown
                  : TrendingUp
              }
              title={
                analysis.performanceLabel === "below_average"
                  ? "Why it underperformed"
                  : "Why it worked"
              }
            />
            <ul className="space-y-1.5">
              {analysis.whyItWorked.map((reason, i) => (
                <li
                  key={i}
                  className="text-base text-neutral-300 leading-relaxed flex gap-2"
                >
                  <span className="text-neutral-600 font-bold mt-0.5">
                    {i + 1}.
                  </span>
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          {/* Caption Breakdown */}
          <div>
            <SectionHeader icon={MessageSquareText} title="Caption Breakdown" />
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Hook", value: analysis.captionBreakdown.hook },
                { label: "Body", value: analysis.captionBreakdown.bodyAnalysis },
                { label: "CTA", value: analysis.captionBreakdown.ctaPresence },
                {
                  label: "Hashtags",
                  value: analysis.captionBreakdown.hashtagStrategy,
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="bg-neutral-800 rounded px-3 py-2 border border-neutral-700"
                >
                  <p className="text-sm font-bold text-neutral-500 uppercase mb-1">
                    {label}
                  </p>
                  <p className="text-sm text-neutral-300 leading-relaxed">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Script Breakdown (video only) */}
          {analysis.scriptBreakdown && (
            <div>
              <SectionHeader icon={Film} title="Video Script Breakdown" />
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Hook", value: analysis.scriptBreakdown.hook },
                  {
                    label: "Delivery",
                    value: analysis.scriptBreakdown.delivery,
                  },
                  {
                    label: "Structure",
                    value: analysis.scriptBreakdown.structure,
                  },
                  {
                    label: "Retention",
                    value: analysis.scriptBreakdown.retention,
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="bg-neutral-800 rounded px-3 py-2 border border-neutral-700"
                  >
                    <p className="text-sm font-bold text-neutral-500 uppercase mb-1">
                      {label}
                    </p>
                    <p className="text-sm text-neutral-300 leading-relaxed">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              {analysis.scriptBreakdown.keyMoments?.length > 0 && (
                <div className="mt-2 bg-neutral-800 rounded px-3 py-2 border border-neutral-700">
                  <p className="text-sm font-bold text-neutral-500 uppercase mb-1">
                    Key Moments
                  </p>
                  <ul className="space-y-1">
                    {analysis.scriptBreakdown.keyMoments.map(
                      (moment: string, i: number) => (
                        <li
                          key={i}
                          className="text-sm text-neutral-300 leading-relaxed"
                        >
                          &ldquo;{moment}&rdquo;
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Engagement Stats */}
          <div>
            <SectionHeader icon={Zap} title="Engagement" />
            <div className="flex gap-3">
              <div className="bg-neutral-800 rounded px-3 py-2 border border-neutral-700 flex-1 text-center">
                <p className="text-xl font-bold text-white">
                  {analysis.engagementBreakdown.likeToCommentRatio}:1
                </p>
                <p className="text-sm text-neutral-500">Like/Comment Ratio</p>
              </div>
              <div className="bg-neutral-800 rounded px-3 py-2 border border-neutral-700 flex-1 text-center">
                <p className="text-xl font-bold text-white capitalize">
                  {analysis.engagementBreakdown.commentQuality}
                </p>
                <p className="text-sm text-neutral-500">Comment Quality</p>
              </div>
              <div className="bg-neutral-800 rounded px-3 py-2 border border-neutral-700 flex-1 text-center">
                <p className="text-xl font-bold text-white">
                  {analysis.engagementBreakdown.viralPotential}
                </p>
                <p className="text-sm text-neutral-500">Viral Potential</p>
              </div>
            </div>
          </div>

          {/* Improvements */}
          <div>
            <SectionHeader icon={Lightbulb} title="How to Improve" />
            <ul className="space-y-1.5">
              {analysis.improvements.map((tip, i) => (
                <li
                  key={i}
                  className="text-base text-neutral-300 leading-relaxed flex gap-2"
                >
                  <Target
                    size={12}
                    className="text-neutral-600 mt-1 flex-shrink-0"
                  />
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          {/* Repost Strategy */}
          <div>
            <SectionHeader icon={Repeat} title="Repost Strategy" />
            <p className="text-base text-neutral-300 leading-relaxed">
              {analysis.repostStrategy}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
