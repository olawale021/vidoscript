import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/openai";

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 300MB limit" },
        { status: 413 }
      );
    }

    // Check file type - accept video or audio
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");

    if (!isVideo && !isAudio) {
      return NextResponse.json(
        { error: "File must be a video or audio file" },
        { status: 400 }
      );
    }

    // For video files, we'd normally extract audio first
    // For prototype, we'll send directly to Whisper (it handles video too)
    const result = await transcribeAudio(file);

    return NextResponse.json({
      transcript: result.text,
      segments: result.segments,
      wordCount: result.text.split(/\s+/).length,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
