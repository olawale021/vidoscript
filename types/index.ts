export type ProjectStatus = "pending" | "processing" | "ready" | "failed";

export type SourceType = "upload" | "youtube";

export type HookType =
  | "question"
  | "statistic"
  | "bold_claim"
  | "story"
  | "controversy"
  | "curiosity";

export type Tone =
  | "casual"
  | "professional"
  | "enthusiastic"
  | "educational"
  | "conversational"
  | "inspirational";

export type Pacing = "fast" | "slow" | "varied" | "building";

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

export interface EngagementScore {
  overall: number;
  hookEffectiveness: number;
  retentionPotential: number;
  ctaClarity: number;
}

export interface Audience {
  primaryAudience: string;
  audienceLevel: string;
  estimatedAgeRange: string;
}

export interface Insights {
  strengths: string[];
  improvements: string[];
}

export interface ContentMetrics {
  wordCount: number;
  estimatedDurationSeconds: number;
  wordsPerMinute: number;
  sentenceCount: number;
  avgSentenceLength: number;
}

export interface User {
  id: string;
  email: string;
  plan: "free" | "pro" | "agency";
  credits: number;
  stripeCustomerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  videoKey?: string;
  audioKey?: string;
  status: ProjectStatus;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transcript {
  id: string;
  projectId: string;
  content: string;
  segments: TranscriptSegment[];
  wordCount: number;
  durationSeconds: number;
  createdAt: Date;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Analysis {
  id: string;
  projectId: string;
  hookType: HookType;
  structure: ScriptStructure;
  tone: Tone;
  pacing: Pacing;
  themes: string[];
  sentiment: Sentiment;
  engagementScore: EngagementScore;
  audience: Audience;
  insights: Insights;
  keyQuotes: string[];
  contentMetrics: ContentMetrics;
  rawAnalysis: Record<string, unknown>;
  createdAt: Date;
}

export interface ScriptStructure {
  intro: string;
  body: string[];
  cta: string;
}

export interface Script {
  id: string;
  projectId: string;
  content: string;
  version: number;
  isEdited: boolean;
  generationParams?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectWithDetails extends Project {
  transcript?: Transcript;
  analysis?: Analysis;
  scripts: Script[];
}
