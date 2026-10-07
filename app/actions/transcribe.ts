"use server";

import { transcribeAudio } from "@/lib/openai";

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

export async function transcribeFile(formData: FormData) {
  const file = formData.get("file") as File | null;

  if (!file) {
    return { error: "No file provided" };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { error: "File size exceeds 300MB limit" };
  }

  const isVideo = file.type.startsWith("video/");
  const isAudio = file.type.startsWith("audio/");

  if (!isVideo && !isAudio) {
    return { error: "File must be a video or audio file" };
  }

  try {
    const result = await transcribeAudio(file);

    return {
      transcript: result.text,
      segments: result.segments,
      wordCount: result.text.split(/\s+/).length,
    };
  } catch (error) {
    console.error("Transcription error:", error);
    return {
      error: error instanceof Error ? error.message : "Transcription failed",
    };
  }
}

// Transcribe a video already uploaded to Convex File Storage. The server pulls
// the bytes from the storage URL, so the browser only uploads the file once and
// large bodies never pass through the Next proxy.
export async function transcribeFromUrl(url: string, mimeType?: string) {
  if (!url || !url.startsWith("https://")) {
    return { error: "Invalid file URL" };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { error: `Could not fetch uploaded file (${res.status})` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return { error: "File size exceeds 300MB limit" };
    }

    const type = mimeType?.startsWith("audio/") ? mimeType : "video/mp4";
    const file = new File([buffer], "upload", { type });
    const result = await transcribeAudio(file);

    return {
      transcript: result.text,
      segments: result.segments,
      wordCount: result.text.split(/\s+/).length,
    };
  } catch (error) {
    console.error("Transcription error:", error);
    return {
      error: error instanceof Error ? error.message : "Transcription failed",
    };
  }
}
