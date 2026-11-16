import "server-only";
import { trackApify } from "@/lib/ai-usage";

// Thin client for Apify's official Instagram Actors (replaces RapidAPI).
// Each call runs an Actor synchronously and returns its dataset items.
// Apify charges per result (≈ $0.0026 each on the free tier), so keep limits small.

export const APIFY_ACTORS = {
  profile: "apify~instagram-profile-scraper",
  scraper: "apify~instagram-scraper",
  post: "apify~instagram-post-scraper",
  hashtag: "apify~instagram-hashtag-scraper",
  comments: "apify~instagram-comment-scraper",
} as const;

// USD per result, Apify FREE tier (Nov 2026). Lower on paid plans.
export const APIFY_PRICE_PER_RESULT = 0.0027;

function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not configured");
  return t;
}

export async function runActor<T = Record<string, unknown>>(
  actor: string,
  input: Record<string, unknown>,
  feature: string,
  timeoutSec = 120
): Promise<T[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=${timeoutSec}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Instagram lookup failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const items = (await res.json()) as (T & { error?: string; errorDescription?: string })[];
  trackApify(feature, actor, items.length, APIFY_PRICE_PER_RESULT);
  // Actors report per-item errors (e.g. "not_found") as dataset rows.
  const real = items.filter((i) => !i.error);
  if (real.length === 0 && items[0]?.error) {
    throw new Error(items[0].errorDescription || items[0].error);
  }
  return real;
}
