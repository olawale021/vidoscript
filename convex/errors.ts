import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireAdmin } from "./admin";

// Error log for Admin → Errors. Written by the render worker (worker secret),
// the Next.js server (internal secret) and Convex actions (internal mutation).

const DAY = 24 * 60 * 60 * 1000;

// Classify an error message so the admin page can group and explain it.
export function errorKind(message: string): string {
  const m = message.toLowerCase();
  if (/quota|free_tier|billing|insufficient (balance|credit)|payment required|402/.test(m)) return "quota";
  if (/429|too many requests|rate limit|queue_full/.test(m)) return "rate_limit";
  if (/401|403|unauthori[sz]ed|invalid (api )?key|credentials|forbidden/.test(m)) return "auth";
  if (/timed? ?out|timeout|etimedout/.test(m)) return "timeout";
  return "other";
}

const fields = {
  feature: v.string(),
  message: v.string(),
  userId: v.optional(v.string()),
  clipId: v.optional(v.string()),
  sourceId: v.optional(v.string()),
};

function row(source: "worker" | "convex" | "app", a: { feature: string; message: string; userId?: string; clipId?: string; sourceId?: string }) {
  return {
    source,
    feature: a.feature.slice(0, 80),
    message: a.message.slice(0, 2000),
    kind: errorKind(a.message),
    ...(a.userId ? { userId: a.userId } : {}),
    ...(a.clipId ? { clipId: a.clipId } : {}),
    ...(a.sourceId ? { sourceId: a.sourceId } : {}),
    createdAt: Date.now(),
  };
}

export const logFromWorker = mutation({
  args: { secret: v.string(), ...fields },
  handler: async (ctx, { secret, ...a }) => {
    const expected = process.env.BROLL_WORKER_SECRET;
    if (!expected || secret !== expected) throw new Error("Bad worker secret");
    await ctx.db.insert("errorLogs", row("worker", a));
    return null;
  },
});

export const logFromApp = mutation({
  args: { secret: v.string(), ...fields },
  handler: async (ctx, { secret, ...a }) => {
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || secret !== expected) throw new Error("Bad internal secret");
    await ctx.db.insert("errorLogs", row("app", a));
    return null;
  },
});

export const log = internalMutation({
  args: fields,
  handler: async (ctx, a) => {
    await ctx.db.insert("errorLogs", row("convex", a));
    return null;
  },
});

export const list = query({
  args: { days: v.number(), includeResolved: v.optional(v.boolean()) },
  handler: async (ctx, { days, includeResolved }) => {
    await requireAdmin(ctx);
    const since = Date.now() - Math.max(1, Math.min(30, days)) * DAY;
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .order("desc")
      .take(500);
    const shown = includeResolved ? rows : rows.filter((r) => !r.resolved);
    const byKind: Record<string, number> = {};
    const byFeature: Record<string, number> = {};
    for (const r of shown) {
      byKind[r.kind ?? "other"] = (byKind[r.kind ?? "other"] ?? 0) + 1;
      byFeature[r.feature] = (byFeature[r.feature] ?? 0) + 1;
    }
    return { rows: shown.slice(0, 200), total: shown.length, byKind, byFeature };
  },
});

export const recentCount = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_created", (q) => q.gte("createdAt", Date.now() - DAY))
      .collect();
    return rows.filter((r) => !r.resolved).length;
  },
});

export const resolveAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("errorLogs")
      .withIndex("by_created", (q) => q.gte("createdAt", Date.now() - 30 * DAY))
      .collect();
    for (const r of rows) if (!r.resolved) await ctx.db.patch(r._id, { resolved: true });
    return null;
  },
});

// Hourly cron: keep 30 days.
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("errorLogs")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - 30 * DAY))
      .take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
