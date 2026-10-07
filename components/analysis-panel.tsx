"use client";

import {
  Gauge,
  Zap,
  Eye,
  MousePointerClick,
  Type,
  Clock,
  Activity,
  AlignLeft,
  Anchor,
  Volume2,
  Heart,
  Users,
  ThumbsUp,
  Lightbulb,
  Quote,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface AnalysisPanelProps {
  analysis: {
    hookType: string;
    tone: string;
    pacing: string;
    structure: { intro: string; body: string[]; cta: string };
    themes: string[];
    sentiment?: string;
    engagementScore?: {
      overall: number;
      hookEffectiveness: number;
      retentionPotential: number;
      ctaClarity: number;
    };
    audience?: {
      primaryAudience: string;
      audienceLevel: string;
      estimatedAgeRange: string;
    };
    insights?: {
      strengths: string[];
      improvements: string[];
    };
    keyQuotes?: string[];
    contentMetrics?: {
      wordCount: number;
      estimatedDurationSeconds: number;
      wordsPerMinute: number;
      sentenceCount: number;
      avgSentenceLength: number;
    };
  };
}

function scoreColor(score: number): string {
  if (score >= 75) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-400";
}

function sentimentDotColor(sentiment: string): string {
  switch (sentiment) {
    case "positive": return "bg-emerald-500";
    case "negative": return "bg-red-500";
    case "mixed": return "bg-amber-500";
    default: return "bg-neutral-500";
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function AnalysisPanel({ analysis }: AnalysisPanelProps) {
  const { engagementScore, contentMetrics, audience, insights, keyQuotes, sentiment } = analysis;

  return (
    <div className="p-5 space-y-6 overflow-y-auto max-h-[calc(100vh-10rem)]">
      {/* Section A: Engagement Scores */}
      {engagementScore && (
        <div>
          <span className="text-sm font-medium text-neutral-500 uppercase tracking-wider">
            Engagement
          </span>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[
              { icon: Gauge, label: "Overall", value: engagementScore.overall },
              { icon: Zap, label: "Hook", value: engagementScore.hookEffectiveness },
              { icon: Eye, label: "Retention", value: engagementScore.retentionPotential },
              { icon: MousePointerClick, label: "CTA", value: engagementScore.ctaClarity },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="border border-neutral-700 rounded-md p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon size={12} className="text-neutral-500" />
                  <span className="text-sm text-neutral-500">{label}</span>
                </div>
                <span className="text-xl font-semibold text-white">{value}</span>
                <Progress
                  value={value}
                  className="mt-1.5 h-1"
                  indicatorClassName={scoreColor(value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section B: Quick Stats */}
      {contentMetrics && (
        <div className="flex items-center gap-2 text-sm text-neutral-500 flex-wrap">
          <span className="flex items-center gap-1">
            <Type size={11} />
            <span className="text-neutral-300 font-medium">{contentMetrics.wordCount.toLocaleString()}</span> words
          </span>
          <span>·</span>
          {contentMetrics.estimatedDurationSeconds > 0 && (
            <>
              <span className="flex items-center gap-1">
                <Clock size={11} />
                <span className="text-neutral-300 font-medium">{formatDuration(contentMetrics.estimatedDurationSeconds)}</span>
              </span>
              <span>·</span>
            </>
          )}
          {contentMetrics.wordsPerMinute > 0 && (
            <>
              <span className="flex items-center gap-1">
                <Activity size={11} />
                <span className="text-neutral-300 font-medium">{contentMetrics.wordsPerMinute}</span> wpm
              </span>
              <span>·</span>
            </>
          )}
          <span className="flex items-center gap-1">
            <AlignLeft size={11} />
            <span className="text-neutral-300 font-medium">{contentMetrics.sentenceCount}</span> sentences
          </span>
        </div>
      )}

      {/* Section C: Content Profile */}
      <div>
        <span className="text-sm font-medium text-neutral-500 uppercase tracking-wider">
          Profile
        </span>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div className="border border-neutral-700 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Anchor size={12} className="text-neutral-500" />
              <span className="text-sm text-neutral-500">Hook</span>
            </div>
            <p className="text-base capitalize text-neutral-300">{analysis.hookType.replace(/_/g, " ")}</p>
          </div>
          <div className="border border-neutral-700 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Volume2 size={12} className="text-neutral-500" />
              <span className="text-sm text-neutral-500">Tone</span>
            </div>
            <p className="text-base capitalize text-neutral-300">{analysis.tone}</p>
          </div>
          <div className="border border-neutral-700 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Activity size={12} className="text-neutral-500" />
              <span className="text-sm text-neutral-500">Pacing</span>
            </div>
            <p className="text-base capitalize text-neutral-300">{analysis.pacing}</p>
          </div>
          <div className="border border-neutral-700 rounded-md p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Heart size={12} className="text-neutral-500" />
              <span className="text-sm text-neutral-500">Sentiment</span>
            </div>
            <div className="flex items-center gap-1.5">
              {sentiment && (
                <span className={cn("w-2 h-2 rounded-full", sentimentDotColor(sentiment))} />
              )}
              <p className="text-base capitalize text-neutral-300">{sentiment || "—"}</p>
            </div>
          </div>
        </div>

        {/* Audience row */}
        {audience && (
          <div className="border border-neutral-700 rounded-md p-3 mt-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Users size={12} className="text-neutral-500" />
              <span className="text-sm text-neutral-500">Audience</span>
            </div>
            <p className="text-base text-neutral-300">
              {audience.primaryAudience}
              <span className="text-neutral-500"> · </span>
              {audience.audienceLevel}
              <span className="text-neutral-500"> · </span>
              {audience.estimatedAgeRange}
            </p>
          </div>
        )}

        {/* Theme pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {analysis.themes.map((theme) => (
            <span
              key={theme}
              className="border border-neutral-700 bg-neutral-800 px-2.5 py-1 rounded-md text-sm text-neutral-400"
            >
              {theme}
            </span>
          ))}
        </div>
      </div>

      {/* Section D: Structure */}
      <div>
        <span className="text-sm font-medium text-neutral-500 uppercase tracking-wider">
          Structure
        </span>
        <div className="mt-2 relative">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-neutral-700" />
          <div className="space-y-2">
            {/* Intro */}
            <div className="flex gap-3 items-start">
              <div className="w-[15px] flex-shrink-0 flex justify-center pt-1.5">
                <div className="w-2 h-2 rounded-full bg-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium tracking-wider text-neutral-500">INTRO</span>
                <p className="text-base text-neutral-400 mt-0.5">{analysis.structure.intro}</p>
              </div>
            </div>

            {/* Body points */}
            {analysis.structure.body.map((point, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-[15px] flex-shrink-0 flex justify-center pt-1.5">
                  <div className="w-2 h-2 rounded-full bg-neutral-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium tracking-wider text-neutral-500">POINT {i + 1}</span>
                  <p className="text-base text-neutral-400 mt-0.5">{point}</p>
                </div>
              </div>
            ))}

            {/* CTA */}
            <div className="flex gap-3 items-start">
              <div className="w-[15px] flex-shrink-0 flex justify-center pt-1.5">
                <div className="w-2 h-2 rounded-full bg-neutral-500" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium tracking-wider text-neutral-500">CTA</span>
                <p className="text-base text-neutral-400 mt-0.5">{analysis.structure.cta}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section E: Insights */}
      {insights && (insights.strengths?.length > 0 || insights.improvements?.length > 0) && (
        <div className="border border-neutral-700 rounded-md">
          {insights.strengths?.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <ThumbsUp size={12} className="text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">Strengths</span>
              </div>
              <ul className="space-y-1.5">
                {insights.strengths.map((s, i) => (
                  <li key={i} className="text-base text-neutral-400 flex gap-2">
                    <span className="text-neutral-600 select-none">-</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insights.strengths?.length > 0 && insights.improvements?.length > 0 && (
            <div className="border-t border-neutral-700" />
          )}
          {insights.improvements?.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb size={12} className="text-amber-400" />
                <span className="text-sm font-medium text-amber-400">Areas to Improve</span>
              </div>
              <ul className="space-y-1.5">
                {insights.improvements.map((s, i) => (
                  <li key={i} className="text-base text-neutral-400 flex gap-2">
                    <span className="text-neutral-600 select-none">-</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Section F: Key Quotes */}
      {keyQuotes && keyQuotes.length > 0 && (
        <div>
          <span className="text-sm font-medium text-neutral-500 uppercase tracking-wider">
            Key Quotes
          </span>
          <div className="mt-2 space-y-2">
            {keyQuotes.map((quote, i) => (
              <div
                key={i}
                className="border-l-2 border-neutral-700 pl-3 flex gap-2 items-start"
              >
                <Quote size={12} className="text-neutral-600 flex-shrink-0 mt-0.5" />
                <p className="italic text-base text-neutral-400">{quote}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
