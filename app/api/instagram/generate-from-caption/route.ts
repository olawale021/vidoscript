import { NextRequest, NextResponse } from "next/server";
import { analyzeTranscript, generateScript } from "@/lib/openai";

export async function POST(request: NextRequest) {
  try {
    const { caption } = await request.json();

    if (!caption || typeof caption !== "string") {
      return NextResponse.json(
        { error: "caption is required" },
        { status: 400 }
      );
    }

    console.log("[API /instagram/generate-from-caption] Analyzing caption...");
    const analysis = await analyzeTranscript(caption);

    console.log("[API /instagram/generate-from-caption] Generating script...");
    const script = await generateScript(
      caption,
      analysis as {
        hookType: string;
        tone: string;
        pacing: string;
        structure: { intro: string; body: string[]; cta: string };
        themes: string[];
      }
    );

    return NextResponse.json({ analysis, script });
  } catch (error) {
    console.error("[API /instagram/generate-from-caption] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate script from caption",
      },
      { status: 500 }
    );
  }
}
