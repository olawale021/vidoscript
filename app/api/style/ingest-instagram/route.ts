import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { transcribeAudio } from "@/lib/openai";
import { analyzeTranscript } from "@/lib/gemini";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // reels are short; 100MB is generous

// Downloads an Instagram reel video, transcribes + analyzes it, and returns the
// style-sample fields. The client (authed with Convex) does the actual write.
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { videoUrl, handle } = await request.json();
    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
    }

    // Download the reel (IG CDN URLs expire, so fetch now)
    const res = await fetch(videoUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not download video (${res.status}) — the link may have expired. Refresh the feed and try again.` },
        { status: 502 }
      );
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "Video too large" }, { status: 413 });
    }

    const file = new File([buffer], "reel.mp4", { type: "video/mp4" });
    const result = await transcribeAudio(file);
    const transcript = result.text?.trim();
    if (!transcript) {
      return NextResponse.json({ error: "No speech found in this video" }, { status: 422 });
    }

    // Structure it (hook extraction etc.) — non-fatal if it fails
    let structuredTranscript: string | null = null;
    let themes: string[] = [];
    let hook: string | null = null;
    try {
      const analysis = (await analyzeTranscript(transcript)) as {
        structuredTranscript?: string;
        themes?: string[];
        structure?: { intro?: string };
      };
      structuredTranscript = analysis.structuredTranscript ?? null;
      themes = Array.isArray(analysis.themes) ? analysis.themes : [];
      const hookMatch = structuredTranscript?.match(/\[HOOK\]\s*\n?([\s\S]*?)(?=\n\s*\[|$)/i);
      hook = hookMatch ? hookMatch[1].trim() : null;
    } catch (e) {
      console.error("Style ingest: analysis failed (storing raw transcript):", e);
    }

    return NextResponse.json({
      transcript,
      structuredTranscript,
      themes,
      hook,
      title: `@${handle || "instagram"} reel`,
    });
  } catch (error) {
    console.error("Style ingest error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingest failed" },
      { status: 500 }
    );
  }
}
