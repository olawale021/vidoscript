import { NextRequest, NextResponse } from "next/server";
import { getCachedUserFeed } from "@/lib/instagram-cache";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("user_id");
  const refresh = req.nextUrl.searchParams.get("refresh") === "true";
  const nextMaxId = req.nextUrl.searchParams.get("next_max_id") || undefined;

  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  try {
    console.log("[API /instagram] Fetching feed for user_id:", userId,
      refresh ? "(force refresh)" : nextMaxId ? `(page max_id=${nextMaxId})` : "(cached)");
    const data = await getCachedUserFeed(userId, { forceRefresh: refresh, nextMaxId });
    console.log("[API /instagram] Feed received:", {
      status: data.status,
      num_results: data.num_results,
      items_count: data.items?.length,
      more_available: data.more_available,
      next_max_id: data.next_max_id,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API /instagram] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch posts" },
      { status: 500 }
    );
  }
}
