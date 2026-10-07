import { NextRequest, NextResponse } from "next/server";
import { getMediaComments } from "@/lib/instagram";

export async function GET(req: NextRequest) {
  // Media ID passed as string to avoid JS float precision loss on 19-digit IDs
  const id = req.nextUrl.searchParams.get("id");
  const nextMinId = req.nextUrl.searchParams.get("next_min_id") || undefined;

  if (!id) {
    return NextResponse.json(
      { error: "id is required" },
      { status: 400 }
    );
  }

  try {
    console.log("[API /instagram/comments] Fetching comments for media:", id);
    const data = await getMediaComments(id, nextMinId);
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
