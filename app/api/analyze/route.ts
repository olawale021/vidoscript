import { NextRequest, NextResponse } from "next/server";
import * as gemini from "@/lib/gemini";
import * as openai from "@/lib/openai";

function getProvider(model?: string) {
  return model === "gpt4o" ? openai : gemini;
}

export async function POST(request: NextRequest) {
  try {
    const { transcript, wordCount, durationSeconds, model } = await request.json();

    if (!transcript) {
      return NextResponse.json(
        { error: "No transcript provided" },
        { status: 400 }
      );
    }

    const provider = getProvider(model);
    const analysis = await provider.analyzeTranscript(transcript, wordCount, durationSeconds);

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
