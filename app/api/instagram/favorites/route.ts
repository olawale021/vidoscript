import { NextRequest, NextResponse } from "next/server";
import {
  getFavoriteCreators,
  toggleFavorite,
  isFavorite,
  getTopPostsAcrossFavorites,
} from "@/lib/instagram-cache";

// GET /api/instagram/favorites — list all favorites, or check one, or get top posts
export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");
  const topPosts = req.nextUrl.searchParams.get("top_posts") === "true";
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 50;

  try {
    if (topPosts) {
      const posts = await getTopPostsAcrossFavorites(limit);
      return NextResponse.json({ posts });
    }

    if (username) {
      const fav = await isFavorite(username);
      return NextResponse.json({ isFavorite: fav });
    }

    const creators = await getFavoriteCreators();
    return NextResponse.json({ creators });
  } catch (error) {
    console.error("[API /instagram/favorites] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get favorites" },
      { status: 500 }
    );
  }
}

// POST /api/instagram/favorites — toggle favorite
export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json();
    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    const isFav = await toggleFavorite(username);
    return NextResponse.json({ isFavorite: isFav, username });
  } catch (error) {
    console.error("[API /instagram/favorites] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to toggle favorite" },
      { status: 500 }
    );
  }
}
