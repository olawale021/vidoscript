import { NextRequest, NextResponse } from "next/server";
import * as gemini from "@/lib/gemini";
import * as openai from "@/lib/openai";
import { validateScenePlan, type PlannerOptions } from "@/lib/broll";

function getProvider(model?: string) {
  return model === "gpt4o" ? openai : gemini;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { script, analysis, theme, aspect, model } = body;

    if (!script || typeof script !== "string") {
      return NextResponse.json(
        { error: "A script string is required" },
        { status: 400 }
      );
    }

    const provider = getProvider(model);
    const options: PlannerOptions = {
      theme: typeof theme === "string" ? theme : undefined,
      aspect: aspect === "16:9" || aspect === "1:1" ? aspect : "9:16",
    };
    const safeAnalysis = analysis && typeof analysis === "object" ? analysis : {};

    // First attempt
    let raw = await provider.planScenes(script, safeAnalysis, options);
    let { plan, errors } = validateScenePlan(raw, options);

    // If it produced nothing usable, retry once with the errors as a repair hint
    if (!plan && errors.length > 0) {
      raw = await provider.planScenes(
        script,
        safeAnalysis,
        options,
        errors.join("\n")
      );
      ({ plan, errors } = validateScenePlan(raw, options));
    }

    if (!plan) {
      return NextResponse.json(
        { error: "Could not produce a valid scene plan", details: errors },
        { status: 502 }
      );
    }

    // `errors` here are non-fatal warnings (repaired issues); surface for the UI
    return NextResponse.json({ plan, warnings: errors });
  } catch (error) {
    console.error("Scene plan error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Planning failed" },
      { status: 500 }
    );
  }
}
