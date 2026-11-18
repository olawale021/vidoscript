import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";

// Called by the Next.js server (lib/ai-usage.ts) after each AI call.
export const record = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    provider: v.union(v.literal("openai"), v.literal("gemini"), v.literal("apify"), v.literal("higgsfield"), v.literal("groq")),
    model: v.string(),
    feature: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    audioSeconds: v.optional(v.number()),
    costUsd: v.number(),
  },
  handler: async (ctx, { secret, ...row }) => {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || secret !== expected) throw new Error("Bad internal secret");
    await ctx.db.insert("aiUsage", { ...row, createdAt: Date.now() });
    return null;
  },
});

// Same as `record`, for Convex actions (no secret needed inside Convex).
export const recordInternal = internalMutation({
  args: {
    userId: v.string(),
    provider: v.union(v.literal("openai"), v.literal("gemini"), v.literal("apify"), v.literal("higgsfield"), v.literal("groq")),
    model: v.string(),
    feature: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    audioSeconds: v.optional(v.number()),
    costUsd: v.number(),
  },
  handler: async (ctx, row) => {
    await ctx.db.insert("aiUsage", { ...row, createdAt: Date.now() });
    return null;
  },
});

const DAY = 24 * 60 * 60 * 1000;

type Group = { key: string; calls: number; costUsd: number; inputTokens: number; outputTokens: number };

function add(map: Map<string, Group>, key: string, u: { costUsd: number; inputTokens: number; outputTokens: number }) {
  let g = map.get(key);
  if (!g) {
    g = { key, calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    map.set(key, g);
  }
  g.calls++;
  g.costUsd += u.costUsd;
  g.inputTokens += u.inputTokens;
  g.outputTokens += u.outputTokens;
}

const sorted = (m: Map<string, Group>) => [...m.values()].sort((a, b) => b.costUsd - a.costUsd);

// Everything the AI costs page needs, for the last `days` days (max 90).
export const dashboard = query({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    await requireAdmin(ctx);
    const span = Math.max(1, Math.min(90, Math.floor(days)));
    const now = Date.now();
    const since = now - span * DAY;
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .collect();

    const startOfToday = new Date(new Date(now).toISOString().slice(0, 10)).getTime();
    const total = (from: number) =>
      rows.filter((r) => r.createdAt >= from).reduce((s, r) => s + r.costUsd, 0);

    const byDay = new Map<string, Group>();
    for (let d = span - 1; d >= 0; d--) {
      const key = new Date(now - d * DAY).toISOString().slice(0, 10);
      byDay.set(key, { key, calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 });
    }
    const byFeature = new Map<string, Group>();
    const byModel = new Map<string, Group>();
    const byUser = new Map<string, Group>();
    for (const r of rows) {
      add(byDay, new Date(r.createdAt).toISOString().slice(0, 10), r);
      add(byFeature, r.feature, r);
      add(byModel, `${r.provider}/${r.model}`, r);
      add(byUser, r.userId, r);
    }

    return {
      days: span,
      calls: rows.length,
      totals: {
        today: total(startOfToday),
        last7: total(now - 7 * DAY),
        last30: total(now - 30 * DAY),
        period: total(since),
      },
      byDay: [...byDay.values()],
      byFeature: sorted(byFeature),
      byModel: sorted(byModel),
      byUser: sorted(byUser),
    };
  },
});

// Sidebar usage card: the signed-in user's own usage this calendar month.
export const myMonth = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const now = new Date();
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_created", (q) => q.eq("userId", identity.subject).gte("createdAt", start))
      .collect();
    let audioSeconds = 0;
    let costUsd = 0;
    for (const r of rows) {
      // Count transcription audio only (TTS also records audioSeconds).
      if (r.provider === "groq" || r.model === "whisper-1") audioSeconds += r.audioSeconds ?? 0;
      costUsd += r.costUsd;
    }
    return { minutes: Math.round(audioSeconds / 60), costUsd: Math.round(costUsd * 100) / 100, calls: rows.length };
  },
});
