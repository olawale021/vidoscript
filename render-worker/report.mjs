// Error reporting + AI retry helpers shared by the worker modules.

import { api } from "../convex/_generated/api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Send a failure to Admin → Errors (convex/errors.ts). Never throws.
export function reportError(convex, { feature, error, userId, clipId, sourceId }) {
  const secret = process.env.BROLL_WORKER_SECRET;
  if (!secret) return;
  const message = error instanceof Error ? error.message : String(error);
  convex
    .mutation(api.errors.logFromWorker, {
      secret,
      feature,
      message,
      ...(userId ? { userId } : {}),
      ...(clipId ? { clipId: String(clipId) } : {}),
      ...(sourceId ? { sourceId: String(sourceId) } : {}),
    })
    .catch(() => {});
}

const isRateLimit = (m) => /429|too many requests|rate limit|resource.?exhausted/i.test(m);
const isDailyQuota = (m) => /per ?day|perday|daily|free_tier_requests.*day|quota exceeded for metric.*per_day/i.test(m);

// Run a Gemini call, retrying short rate limits (requests per minute) with the
// delay Google suggests. Daily / billing quota errors become a clear message.
export async function withAiRetry(fn, { attempts = 3 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isRateLimit(msg)) throw e;
      if (isDailyQuota(msg) || i >= attempts - 1) {
        const free = /free_tier/i.test(msg);
        throw new Error(
          free
            ? "Gemini free-tier quota reached. Turn on billing for the Gemini API key in Google AI Studio, then click Retry / Regenerate."
            : `Gemini rate limit reached — try again in a few minutes. (${msg.slice(0, 160)})`
        );
      }
      const hinted = msg.match(/retry in ([\d.]+)s|"retryDelay":"(\d+)s"/i);
      const wait = Math.min(60, Number(hinted?.[1] ?? hinted?.[2]) || 15 * (i + 1));
      console.warn(`[ai] rate limited, retrying in ${wait}s`);
      await sleep(wait * 1000);
    }
  }
}
