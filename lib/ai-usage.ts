import "server-only";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { tokenCost, whisperCost } from "@/lib/ai-pricing";

// Records one row per AI call in Convex (aiUsage) for the admin cost page.
// Fire-and-forget: tracking must never slow down or break a user request.

let client: ConvexHttpClient | null = null;
function convex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  client ??= new ConvexHttpClient(url);
  return client;
}

async function currentUserId(): Promise<string> {
  try {
    const { userId } = await auth();
    return userId ?? "anonymous";
  } catch {
    return "anonymous"; // called outside a request (no Clerk context)
  }
}

type Row = {
  provider: "openai" | "gemini";
  model: string;
  feature: string;
  inputTokens: number;
  outputTokens: number;
  audioSeconds?: number;
  costUsd: number;
};

function record(row: Row) {
  const secret = process.env.INTERNAL_API_SECRET;
  const c = convex();
  if (!secret || !c) return;
  void (async () => {
    try {
      const userId = await currentUserId();
      await c.mutation(api.usage.record, { secret, userId, ...row });
    } catch (e) {
      console.warn("[ai-usage] failed to record:", e instanceof Error ? e.message : e);
    }
  })();
}

type OpenAIChatResponse = {
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

export function trackOpenAI(res: OpenAIChatResponse, feature: string, fallbackModel = "gpt-4o") {
  const model = res.model ?? fallbackModel;
  const inputTokens = res.usage?.prompt_tokens ?? 0;
  const outputTokens = res.usage?.completion_tokens ?? 0;
  record({
    provider: "openai",
    model,
    feature,
    inputTokens,
    outputTokens,
    costUsd: tokenCost(model, inputTokens, outputTokens),
  });
}

export function trackWhisper(res: { duration?: number | string }, feature: string) {
  const audioSeconds = Number(res.duration ?? 0) || 0;
  record({
    provider: "openai",
    model: "whisper-1",
    feature,
    inputTokens: 0,
    outputTokens: 0,
    audioSeconds,
    costUsd: whisperCost(audioSeconds),
  });
}

type GeminiResult = {
  response: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };
};

export function trackGemini(result: GeminiResult, feature: string, model = "gemini-2.5-flash") {
  const u = result.response.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  // Gemini bills thinking tokens as output.
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  record({
    provider: "gemini",
    model,
    feature,
    inputTokens,
    outputTokens,
    costUsd: tokenCost(model, inputTokens, outputTokens),
  });
}
