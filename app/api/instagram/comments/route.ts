import { NextRequest, NextResponse } from "next/server";
import { getMediaComments } from "@/lib/instagram";

export async function GET(req: NextRequest) {
  // Post shortcode (instagram.com/p/{shortcode}); Apify looks comments up by URL.
  const shortcode = req.nextUrl.searchParams.get("shortcode");
  const nextMinId = req.nextUrl.searchParams.get("next_min_id") || undefined;

  if (!shortcode) {
    return NextResponse.json(
      { error: "shortcode is required" },
      { status: 400 }
    );
  }

  try {
    console.log("[API /instagram/comments] Fetching comments for post:", shortcode);
    const data = await getMediaComments(shortcode, nextMinId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API /instagram/comments] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch comments",
      },
      { status: 500 }
    );
  }
}
