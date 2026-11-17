import { NextRequest, NextResponse } from "next/server";
import { getHashtagFeed } from "@/lib/instagram";
import { logAppError } from "@/lib/app-errors";

export async function GET(req: NextRequest) {
  const tag = req.nextUrl.searchParams.get("tag");
  const section = req.nextUrl.searchParams.get("section") || "recent";

  if (!tag) {
    return NextResponse.json({ error: "tag is required" }, { status: 400 });
  }

  // Cursor = number of posts already shown (see lib/instagram.ts).
  const cursor = req.nextUrl.searchParams.get("max_id");

  try {
    console.log("[API /instagram/hashtag] Fetching tag:", tag, "section:", section);
    const data = await getHashtagFeed(tag, section, cursor);
    return NextResponse.json(data);
  } catch (error) {
    logAppError("api/instagram/hashtag", error);
    console.error("[API /instagram/hashtag] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch hashtag feed",
      },
      { status: 500 }
    );
  }
}
