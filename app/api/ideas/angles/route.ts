import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export interface GeneratedAngle {
  label: string; // e.g. "Contrarian take"
  topic: string; // the reframed topic, ready to become an idea
  hook: string; // suggested opening line
}

// Takes another creator's post and produces 5 original angles on its topic —
// "steal the topic, not the content". The client saves picks to the Idea Bank.
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caption, creatorHandle, transcript, multiplier } = await request.json();
    const sourceText = [
      caption ? `Caption:\n${caption}` : null,
      transcript ? `Transcript:\n${transcript}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!sourceText) {
      return NextResponse.json(
        { error: "This post has no caption to work from — try Analyze Post instead" },
        { status: 400 }
      );
    }

    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content: `You help a short-form video creator turn another creator's post into ORIGINAL content ideas for themselves. The rule is "steal the topic, not the content": identify the underlying topic and produce fresh angles the creator can make their own — never rephrase or copy the original.

Return JSON exactly in this shape:
{
  "topicSummary": "one sentence naming the underlying topic of the source post",
  "angles": [
    { "label": "Contrarian take", "topic": "...", "hook": "..." },
    { "label": "Beginner version", "topic": "...", "hook": "..." },
    { "label": "Personal story", "topic": "...", "hook": "..." },
    { "label": "What they missed", "topic": "...", "hook": "..." },
    { "label": "Updated for today", "topic": "...", "hook": "..." }
  ]
}

Rules:
- "topic" is a concrete, specific video idea (a sentence, not a title in quotes) the creator could film this week.
- "hook" is a spoken opening line (max ~15 words) that would stop the scroll — punchy, first person, no hashtags.
- Angles must be clearly distinct from each other and from the source post.
- Write in plain, natural spoken language. No emojis, no marketing-speak.`,
        },
        {
          role: "user",
          content: `Source post by @${creatorHandle || "unknown"}${
            typeof multiplier === "number" && multiplier > 1
              ? ` (this post did ${multiplier.toFixed(1)}x the creator's usual engagement — the topic clearly resonates)`
              : ""
          }:

${sourceText}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from the model");
    const parsed = JSON.parse(raw) as {
      topicSummary?: string;
      angles?: GeneratedAngle[];
    };
    if (!Array.isArray(parsed.angles) || parsed.angles.length === 0) {
      throw new Error("The model returned no angles — try again");
    }

    return NextResponse.json({
      topicSummary: parsed.topicSummary ?? null,
      angles: parsed.angles
        .filter((a) => a && a.topic)
        .map((a) => ({
          label: a.label || "Angle",
          topic: a.topic,
          hook: a.hook || "",
        })),
    });
  } catch (error) {
    console.error("Angle generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate angles" },
      { status: 500 }
    );
  }
}
