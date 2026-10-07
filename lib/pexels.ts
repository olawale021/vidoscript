// Pexels stock resolver for b-roll "footage" scenes. Server-side only (keeps the
// API key secret). Get a free key at https://www.pexels.com/api/ and set
// PEXELS_API_KEY in .env.local.

import type { Aspect } from "@/types/broll";

export interface ResolvedAsset {
  type: "video" | "image";
  url: string; // playable/displayable media URL
  thumbnail: string;
  credit: string; // photographer/creator name for attribution
  creditUrl: string;
}

function orientationFor(aspect?: Aspect): "portrait" | "landscape" | "square" {
  if (aspect === "16:9") return "landscape";
  if (aspect === "1:1") return "square";
  return "portrait";
}

function apiKey(): string {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("PEXELS_API_KEY is not set");
  return key;
}

interface PexelsVideoFile {
  link: string;
  quality: string;
  width: number | null;
  height: number | null;
  file_type: string;
}

// Pick a reasonably sized mp4 (cap height ~1080 to keep render cost sane).
function pickVideoFile(files: PexelsVideoFile[]): string | null {
  const mp4 = files.filter((f) => f.file_type === "video/mp4");
  if (mp4.length === 0) return null;
  const sized = mp4
    .filter((f) => (f.height ?? 0) >= 480)
    .sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  const preferred = sized.find((f) => (f.height ?? 0) >= 1000) || sized[sized.length - 1] || mp4[0];
  return preferred.link;
}

export async function resolveFootage(
  query: string,
  aspect?: Aspect,
  type: "video" | "image" = "video"
): Promise<ResolvedAsset | null> {
  const orientation = orientationFor(aspect);
  const headers = { Authorization: apiKey() };

  if (type === "video") {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=8&orientation=${orientation}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Pexels video search failed (${res.status})`);
    const data = await res.json();
    const videos = data.videos || [];
    if (videos.length === 0) return null;
    const v = videos[Math.floor(0)]; // top result (deterministic)
    const link = pickVideoFile(v.video_files || []);
    if (!link) return null;
    return {
      type: "video",
      url: link,
      thumbnail: v.image || "",
      credit: v.user?.name || "Pexels",
      creditUrl: v.user?.url || "https://www.pexels.com",
    };
  }

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=8&orientation=${orientation}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Pexels photo search failed (${res.status})`);
  const data = await res.json();
  const photos = data.photos || [];
  if (photos.length === 0) return null;
  const p = photos[0];
  return {
    type: "image",
    url: p.src?.large2x || p.src?.large || p.src?.original,
    thumbnail: p.src?.medium || "",
    credit: p.photographer || "Pexels",
    creditUrl: p.photographer_url || "https://www.pexels.com",
  };
}
