import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { transcribeAudio } from "@/lib/openai";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

function scoreToLabel(score: number): string {
  if (score >= 85) return "viral";
  if (score >= 65) return "above_average";
  if (score >= 40) return "average";
  return "below_average";
}

async function transcribeVideoFromUrl(
  videoUrl: string
): Promise<string | null> {
  try {
    console.log("[analyze-post] Downloading video for transcription...");
    const res = await fetch(videoUrl);
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const file = new File([buffer], "video.mp4", { type: "video/mp4" });

    if (file.size > 300 * 1024 * 1024) {
      console.log("[analyze-post] Video too large, skipping transcription");
      return null;
    }

    console.log(
      "[analyze-post] Transcribing video (" +
        (file.size / (1024 * 1024)).toFixed(1) +
        "MB)..."
    );
    const result = await transcribeAudio(file);
    return result.text || null;
  } catch (err) {
    console.error("[analyze-post] Transcription failed:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { post, feedContext } = await request.json();

    if (!post) {
      return NextResponse.json(
        { error: "post data is required" },
        { status: 400 }
      );
    }

    const mediaTypeLabel =
      post.media_type === 1
        ? "Image"
        : post.media_type === 2
          ? "Video/Reel"
          : post.media_type === 8
            ? "Carousel"
            : "Unknown";

    const date = new Date(post.taken_at * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const caption = post.caption?.text || "";
    const likes = post.like_count ?? 0;
    const comments = post.comment_count ?? 0;
    const totalEngagement = likes + comments;

    // Transcribe video if it's a video/reel
    let transcript: string | null = null;
    if (post.media_type === 2 && post.video_url) {
      transcript = await transcribeVideoFromUrl(post.video_url);
    }

    // Pre-compute comparison metrics
    let engagementMultiplier = "N/A";
    let isAboveAvg = false;
    if (feedContext) {
      const avgEng = feedContext.avgLikes + feedContext.avgComments;
      if (avgEng > 0) {
        const mult = totalEngagement / avgEng;
        engagementMultiplier = mult.toFixed(1) + "x";
        isAboveAvg = mult > 1;
      }
    }

    const likeCommentRatio =
      comments > 0 ? (likes / comments).toFixed(1) : "N/A";

    console.log(
      "[API /instagram/analyze-post] Analyzing post:",
      post.id,
      transcript ? "(with transcript)" : "(caption only)"
    );

    // Build structured system prompt
    const systemPrompt = buildSystemPrompt(!!transcript);
    const userPrompt = buildUserPrompt({
      mediaTypeLabel,
      date,
      likes,
      comments,
      totalEngagement,
      likeCommentRatio,
      caption,
      transcript,
      videoDuration: post.video_duration,
      carouselCount: post.carousel_media_count,
      feedContext,
      engagementMultiplier,
      isAboveAvg,
    });

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No analysis returned");

    const analysis = JSON.parse(content);

    // Enforce label from score (never trust LLM for this)
    const rating = analysis.performanceRating ?? 50;
    analysis.performanceLabel = scoreToLabel(rating);

    analysis.postStats = {
      likes,
      comments,
      totalEngagement,
      mediaType: mediaTypeLabel,
      date,
    };
    analysis.hasTranscript = !!transcript;

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("[API /instagram/analyze-post] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to analyze post",
      },
      { status: 500 }
    );
  }
}

// --- Prompt Builders ---

function buildSystemPrompt(hasTranscript: boolean): string {
  return `You are an expert Instagram growth strategist with deep knowledge of the algorithm, content virality, and audience psychology. You analyze Instagram posts with precision and give specific, data-backed insights — never generic advice.

## YOUR TASK
Analyze a single Instagram post and return a structured JSON analysis. ${hasTranscript ? "You will receive BOTH the caption AND a full transcript of what is spoken in the video." : "You will receive the caption and engagement metrics."}

## SCORING RULES (CRITICAL — follow exactly)
performanceRating is a 1-100 score based on CONTENT QUALITY + ENGAGEMENT CONTEXT:
- 85-100: Exceptional. Viral-worthy content, strong hook, high engagement relative to account size.
- 65-84: Above average. Solid content that performs well, good structure and execution.
- 40-64: Average. Decent content but nothing remarkable, typical engagement.
- 0-39: Below average. Weak content, poor execution, low engagement.

When feed context is provided, use the engagement multiplier:
- 2x+ average = likely 80-100 range
- 1x-2x average = likely 60-80 range
- 0.5x-1x average = likely 40-60 range
- Below 0.5x average = likely below 40

## ANALYSIS PRINCIPLES
- Be SPECIFIC: Reference actual words, phrases, and techniques from the caption/transcript. Never say "the hook is effective" without explaining exactly what words make it effective.
- Be HONEST: If something is weak, say so clearly. Don't sugarcoat.
- Be ACTIONABLE: Every improvement should be a concrete action, not a vague suggestion.
${hasTranscript ? "- PRIORITIZE the video transcript in your analysis. The spoken content is what viewers actually experience. The caption is secondary." : ""}

## REQUIRED JSON STRUCTURE

{
  "performanceRating": <number 1-100>,
  "whyItWorked": [<3-5 strings, each 1-2 sentences, SPECIFIC reasons citing actual content>],
  "captionBreakdown": {
    "hook": "<analyze the first line — what technique is used? question, bold claim, curiosity gap, stat?>",
    "bodyAnalysis": "<structure, readability, value delivery, storytelling quality>",
    "ctaPresence": "<is there a CTA? what type? how strong? specific wording analysis>",
    "hashtagStrategy": "<count, relevance, mix of broad vs niche, placement>",
    "emojiUsage": "<how are emojis used? do they add structure or feel spammy?>",
    "length": "<short|medium|long — is this optimal for the content type and platform?>"
  },${hasTranscript ? `
  "scriptBreakdown": {
    "hook": "<first 3-5 seconds analysis — what grabs attention? exact words used>",
    "delivery": "<speaking pace, energy level, tone, confidence, verbal tics>",
    "structure": "<how the video flows: intro → points → conclusion. is there a narrative arc?>",
    "retention": "<what keeps viewers watching? where might they drop off? pattern interrupts?>",
    "keyMoments": ["<2-3 exact standout quotes or moments from the transcript>"]
  },` : ""}
  "formatAnalysis": "<why this format was right/wrong for the content, what format would work better>",
  "engagementBreakdown": {
    "likeToCommentRatio": <number, pre-calculated>,
    "commentQuality": "<high|moderate|low — based on ratio and content type>",
    "viralPotential": <number 1-100, based on shareability, save-worthiness, relatability>
  },
  "improvements": [<4-6 strings, each VERY specific and actionable>],
  "repostStrategy": "<1-2 sentences on how to repurpose this exact content for better reach>",
  "keyTakeaway": "<ONE sentence — the single most important lesson from this post>"
}

Return ONLY valid JSON. No markdown, no comments, no extra text.`;
}

function buildUserPrompt(data: {
  mediaTypeLabel: string;
  date: string;
  likes: number;
  comments: number;
  totalEngagement: number;
  likeCommentRatio: string;
  caption: string;
  transcript: string | null;
  videoDuration?: number;
  carouselCount?: number;
  feedContext?: { avgLikes: number; avgComments: number; totalPosts: number };
  engagementMultiplier: string;
  isAboveAvg: boolean;
}): string {
  let prompt = `## POST DATA

| Metric | Value |
|--------|-------|
| Format | ${data.mediaTypeLabel} |
| Date | ${data.date} |
| Likes | ${data.likes.toLocaleString()} |
| Comments | ${data.comments.toLocaleString()} |
| Total Engagement | ${data.totalEngagement.toLocaleString()} |
| Like:Comment Ratio | ${data.likeCommentRatio} |`;

  if (data.videoDuration) {
    prompt += `\n| Video Duration | ${Math.round(data.videoDuration)}s |`;
  }
  if (data.carouselCount) {
    prompt += `\n| Carousel Slides | ${data.carouselCount} |`;
  }

  if (data.feedContext) {
    prompt += `

## ACCOUNT CONTEXT (from ${data.feedContext.totalPosts} recent posts)

| Metric | Value |
|--------|-------|
| Avg Likes | ${data.feedContext.avgLikes.toLocaleString()} |
| Avg Comments | ${data.feedContext.avgComments.toLocaleString()} |
| Avg Total Engagement | ${(data.feedContext.avgLikes + data.feedContext.avgComments).toLocaleString()} |
| **This Post vs Average** | **${data.engagementMultiplier}** (${data.isAboveAvg ? "above" : "below"} average) |`;
  }

  prompt += `

## CAPTION
${data.caption ? `"""
${data.caption}
"""` : "(No caption)"}`;

  if (data.transcript) {
    prompt += `

## VIDEO TRANSCRIPT (spoken content — this is what viewers hear)
"""
${data.transcript}
"""`;
  }

  prompt += `

Analyze this post now. Remember: be specific, cite actual content, and follow the scoring rules precisely.`;

  return prompt;
}
