import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getTopPostsAcrossFavorites } from "@/lib/instagram-cache";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 30;

  try {
    const posts = await getTopPostsAcrossFavorites(limit);

    if (posts.length === 0) {
      return NextResponse.json({
        topics: [],
        message: "No cached posts found. Load creator feeds first.",
      });
    }

    // Build a compact summary of each post for the AI
    const postSummaries = posts.map((p, i) => ({
      index: i,
      id: p.id,
      creator: p.user?.username || "unknown",
      type: p.media_type === 1 ? "Image" : p.media_type === 2 ? "Reel" : p.media_type === 8 ? "Carousel" : "Post",
      likes: p.like_count ?? 0,
      comments: p.comment_count ?? 0,
      engagement: (p.like_count ?? 0) + (p.comment_count ?? 0),
      caption: (p.caption?.text || "").slice(0, 500),
      date: new Date(p.taken_at * 1000).toISOString().split("T")[0],
      duration: p.video_duration ? Math.round(p.video_duration) : undefined,
    }));

    console.log(`[Scout] Analyzing ${postSummaries.length} top posts across favorites...`);

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(postSummaries) },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No analysis returned");

    const analysis = JSON.parse(content);

    // Attach full post data to each recommendation
    for (const topic of analysis.topics || []) {
      for (const rec of topic.recommendations || []) {
        const post = posts[rec.postIndex];
        if (post) {
          rec.post = post;
        }
      }
    }

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("[API /instagram/scout] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to scout" },
      { status: 500 }
    );
  }
}

const SYSTEM_PROMPT = `You are a viral content strategist. You receive a JSON array of top-performing Instagram posts from creators the user follows.

Your job: identify recurring TOPICS/THEMES, then for each topic pick the best posts and write a short recreation brief.

## RULES
- Identify 3-6 distinct content topics/themes from the posts
- For each topic, select 2-4 of the best posts that fit
- Write a concise recreation brief for each selected post
- Focus on ACTIONABLE advice: what to film, say, structure, hook with
- Consider the user wants to create SIMILAR content that could also go viral

## REQUIRED JSON OUTPUT

{
  "topics": [
    {
      "name": "<short topic name, e.g. 'AI Tool Tutorials'>",
      "description": "<1 sentence why this topic is trending/performing>",
      "recommendations": [
        {
          "postIndex": <number - index from the input array>,
          "viralScore": <1-100 based on engagement + content quality>,
          "whyItWentViral": "<1-2 sentences, specific>",
          "recreationBrief": "<2-4 sentences: exact angle, hook idea, structure, what to show/say>",
          "suggestedHook": "<the first line or opening 3 seconds you'd use>"
        }
      ]
    }
  ],
  "overallInsight": "<1-2 sentences: the #1 pattern across all top posts that the user should lean into>"
}

Return ONLY valid JSON.`;
