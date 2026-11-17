import "server-only";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

// Send an API-route failure to Admin → Errors (convex/errors.ts). Never throws
// and never delays the response.
let client: ConvexHttpClient | null = null;

export function logAppError(feature: string, error: unknown) {
  const secret = process.env.INTERNAL_API_SECRET;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!secret || !url) return;
  client ??= new ConvexHttpClient(url);
  const c = client;
  const message = error instanceof Error ? error.message : String(error);
  void (async () => {
    let userId: string | undefined;
    try {
      userId = (await auth()).userId ?? undefined;
    } catch {
      // outside a request
    }
    await c.mutation(api.errors.logFromApp, { secret, feature, message, ...(userId ? { userId } : {}) });
  })().catch(() => {});
}
