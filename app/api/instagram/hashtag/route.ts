import { NextRequest, NextResponse } from "next/server";
import { getHashtagFeed } from "@/lib/instagram";

export async function GET(req: NextRequest) {
  const tag = req.nextUrl.searchParams.get("tag");
  const section = req.nextUrl.searchParams.get("section") || "recent";

  if (!tag) {
    return NextResponse.json({ error: "tag is required" }, { status: 400 });
  }

  const maxId = req.nextUrl.searchParams.get("max_id");
  const page = req.nextUrl.searchParams.get("page");
  const rankToken = req.nextUrl.searchParams.get("rank_token");

  const pagination =
    maxId && page && rankToken
      ? { max_id: maxId, page, rank_token: rankToken }
      : undefined;

  try {
    console.log("[API /instagram/hashtag] Fetching tag:", tag, "section:", section);
    const data = await getHashtagFeed(tag, section, pagination);
    return NextResponse.json(data);
  } catch (error) {
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
