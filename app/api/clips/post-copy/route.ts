import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { writeClipPostCopy } from "@/lib/gemini";
import { logAppError } from "@/lib/app-errors";

// Caption + exactly 5 hashtags for a clip (clip editor "Post caption").
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { title?: string; hook?: string; transcript?: string };
    const copy = await writeClipPostCopy({
      title: String(body.title ?? "").slice(0, 200),
      hook: String(body.hook ?? "").slice(0, 300),
      transcript: String(body.transcript ?? "").slice(0, 4000),
    });
    return NextResponse.json(copy);
  } catch (error) {
    logAppError("api/clips/post-copy", error);
    const msg = error instanceof Error ? error.message : "Could not write the caption";
    return NextResponse.json({ error: /quota|429/i.test(msg) ? "AI quota reached — try again shortly" : msg }, { status: 500 });
  }
}
