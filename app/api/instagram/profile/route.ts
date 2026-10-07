import { NextRequest, NextResponse } from "next/server";
import { getCachedProfile } from "@/lib/instagram-cache";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  try {
    console.log("[API /instagram/profile] Looking up username:", username);
    const profile = await getCachedProfile(username);
    console.log("[API /instagram/profile] Result:", profile.username, profile.pk);
    return NextResponse.json(profile);
  } catch (error) {
    console.error("[API /instagram/profile] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to look up user" },
      { status: 500 }
    );
  }
}
