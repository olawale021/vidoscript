import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { suggestBrollPrompt } from "@/lib/gemini";
import { logAppError } from "@/lib/app-errors";

// Suggest a text-to-video prompt for an AI B-roll shot (clip editor).
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as {
      clipTitle?: string;
      spoken?: string;
      idea?: string;
      aspect?: string;
      seconds?: number;
    };
    const prompt = await suggestBrollPrompt({
      clipTitle: String(body.clipTitle ?? "").slice(0, 200),
      spoken: String(body.spoken ?? "").slice(0, 1500),
      idea: body.idea ? String(body.idea).slice(0, 400) : undefined,
      aspect: ["9:16", "1:1", "16:9"].includes(String(body.aspect)) ? String(body.aspect) : "9:16",
      seconds: Math.max(2, Math.min(15, Number(body.seconds) || 3)),
    });
    return NextResponse.json({ prompt });
  } catch (error) {
    logAppError("api/clips/broll-prompt", error);
    const msg = error instanceof Error ? error.message : "Could not suggest a prompt";
    return NextResponse.json({ error: /quota|429/i.test(msg) ? "AI quota reached — try again shortly" : msg }, { status: 500 });
  }
}
