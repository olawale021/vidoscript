import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { StorageReader } from "convex/server";

// Cloudflare R2 file storage. Credentials come from Convex env:
// R2_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET.
export const r2 = new R2(components.r2);

// One bucket is shared by localhost (dev) and app.vidoscript.app (prod);
// every object key starts with this prefix so the two never collide.
export function storagePrefix(): string {
  const p = process.env.STORAGE_PREFIX;
  if (p !== "dev" && p !== "prod") {
    throw new Error("STORAGE_PREFIX must be set to 'dev' or 'prod' in the Convex env");
  }
  return p;
}

export const SIX_HOURS = 6 * 60 * 60;

// A playable URL for a file that lives in R2 (key) or, for rows created before
// the R2 move, in Convex storage (storageId). R2 wins when both are set.
export async function fileUrl(
  ctx: { storage: StorageReader },
  file: { key?: string | null; storageId?: Id<"_storage"> | null },
  expiresIn = SIX_HOURS
): Promise<string | null> {
  if (file.key) return await r2.getUrl(file.key, { expiresIn });
  if (file.storageId) return await ctx.storage.getUrl(file.storageId);
  return null;
}

// Signed URLs for AI B-roll shots stored in R2 (smart.broll[].assetKey).
export async function aiShotUrls(smart: unknown): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const broll = (smart as { broll?: { id: string; assetKey?: string | null }[] } | null)?.broll ?? [];
  for (const b of broll) if (b.assetKey) out[b.id] = await r2.getUrl(b.assetKey, { expiresIn: SIX_HOURS });
  return out;
}

export function extFromName(fileName: string | undefined, contentType: string | undefined, fallback = "mp4") {
  const m = fileName?.toLowerCase().match(/\.([a-z0-9]{2,4})$/);
  if (m) return m[1];
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return fallback;
}
