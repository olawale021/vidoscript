import { NextRequest, NextResponse } from "next/server";
import { resolveFootage, type ResolvedAsset } from "@/lib/pexels";
import type { Aspect } from "@/types/broll";

// POST { queries: string[], aspect?, type? } -> { assets: (ResolvedAsset|null)[] }
// Resolves several footage queries in one call (one per scene).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const queries: string[] = Array.isArray(body.queries) ? body.queries : [];
    const aspect: Aspect | undefined = body.aspect;
    const type: "video" | "image" = body.type === "image" ? "image" : "video";

    if (!process.env.PEXELS_API_KEY) {
      return NextResponse.json(
        { error: "PEXELS_API_KEY is not set", assets: queries.map(() => null) },
        { status: 200 }
      );
    }

    const assets: (ResolvedAsset | null)[] = await Promise.all(
      queries.map((q) =>
        q?.trim() ? resolveFootage(q, aspect, type).catch(() => null) : Promise.resolve(null)
      )
    );

    return NextResponse.json({ assets });
  } catch (error) {
    console.error("Asset resolve error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Asset resolve failed" },
      { status: 500 }
    );
  }
}
