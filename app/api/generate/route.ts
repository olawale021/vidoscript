import { NextRequest, NextResponse } from "next/server";
import * as gemini from "@/lib/gemini";
import * as openai from "@/lib/openai";

function getProvider(model?: string) {
  return model === "gpt4o" ? openai : gemini;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transcript, analysis, topic, tone, model } = body;
    const provider = getProvider(model);
    // Style Bank exemplars (real transcripts) fetched client-side from Convex
    const styleSamples: string[] = Array.isArray(body.styleSamples)
      ? body.styleSamples.filter((s: unknown) => typeof s === "string").slice(0, 6)
      : [];

    if (!transcript || !analysis) {
      return NextResponse.json(
        { error: "Transcript and analysis are required" },
        { status: 400 }
      );
    }

    // Whole-script chat refine (ongoing conversation to edit the full script)
    if (body.chatRefine && body.chatMessage) {
      const { currentScript, chatMessage, history } = body;
      if (!currentScript) {
        return NextResponse.json(
          { error: "Current script is required to refine" },
          { status: 400 }
        );
      }

      const script = await provider.chatRefineScript(
        currentScript,
        chatMessage,
        analysis,
        tone,
        topic,
        history,
        styleSamples
      );

      return NextResponse.json({ script });
    }

    // Chat-based section rewrite
    if (body.section && body.chatInstruction) {
      const { currentScript, section, sectionContent, chatInstruction } = body;
      if (!currentScript || !sectionContent) {
        return NextResponse.json(
          { error: "Current script and section content are required" },
          { status: 400 }
        );
      }

      const variations = await provider.chatRewriteSection(
        currentScript,
        section.type,
        section.label,
        sectionContent,
        chatInstruction,
        tone,
        5,
        topic
      );

      return NextResponse.json({ variations });
    }

    // Section variations mode (rewrite with 5 options)
    if (body.section && body.variations) {
      const { currentScript, section } = body;
      if (!currentScript) {
        return NextResponse.json(
          { error: "Current script is required for section variations" },
          { status: 400 }
        );
      }

      const variations = await provider.regenerateSectionVariations(
        currentScript,
        section.type,
        section.label,
        analysis,
        tone,
        body.variationCount || 5,
        topic
      );

      return NextResponse.json({ variations });
    }

    // Section regeneration mode (single rewrite)
    if (body.section) {
      const { currentScript, section } = body;
      if (!currentScript) {
        return NextResponse.json(
          { error: "Current script is required for section regeneration" },
          { status: 400 }
        );
      }

      const newContent = await provider.regenerateSection(
        currentScript,
        section.type,
        section.label,
        analysis,
        tone,
        topic
      );

      return NextResponse.json({ sectionContent: newContent });
    }

    // Prior chat instructions (user messages) still apply on regeneration
    const priorInstructions: string[] = Array.isArray(body.history)
      ? body.history
          .filter(
            (m: { role?: string; content?: unknown }) =>
              m?.role === "user" && typeof m.content === "string"
          )
          .map((m: { content: string }) => m.content.slice(0, 2000))
          .slice(-5)
      : [];

    // Idea projects: no source video — the Style Bank carries the voice, the
    // user's topic/rough notes carry the content.
    if (body.fromIdea && typeof body.idea === "string" && body.idea.trim()) {
      const script = await provider.generateScriptFromIdea(body.idea, {
        tone,
        styleSamples,
        priorInstructions,
        extraDirection: typeof topic === "string" ? topic : undefined,
      });
      return NextResponse.json({ script });
    }

    // Full script generation
    const script = await provider.generateScript(
      transcript,
      analysis,
      topic,
      tone,
      styleSamples,
      priorInstructions
    );

    return NextResponse.json({ script });
  } catch (error) {
    console.error("Generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}
