import { NextRequest, NextResponse } from "next/server";
import { getPostByShortcode } from "@/lib/instagram";

export async function GET(req: NextRequest) {
  const shortcode = req.nextUrl.searchParams.get("shortcode");

  if (!shortcode) {
    return NextResponse.json(
      { error: "shortcode is required" },
      { status: 400 }
    );
  }

  try {
    console.log("[API /instagram/post] Fetching shortcode:", shortcode);
    const data = await getPostByShortcode(shortcode);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API /instagram/post] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch post",
      },
      { status: 500 }
    );
  }
}
