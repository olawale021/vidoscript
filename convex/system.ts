import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { assertWorker } from "./broll";
import { requireAdmin } from "./admin";

const HOUR = 60 * 60 * 1000;

// Sent by the render worker every 30 s. Values are the host's (/proc in the
// container reports host load and memory; "/" is the host disk).
export const heartbeat = mutation({
  args: {
    secret: v.string(),
    loadAvg1: v.number(),
    loadAvg5: v.number(),
    loadAvg15: v.number(),
    cpuCount: v.number(),
    memTotal: v.number(),
    memAvailable: v.number(),
    swapTotal: v.number(),
    swapFree: v.number(),
    diskTotal: v.number(),
    diskFree: v.number(),
    workerBusy: v.boolean(),
    currentRenderId: v.optional(v.id("renders")),
  },
  handler: async (ctx, { secret, ...stats }) => {
    assertWorker(secret);
    await ctx.db.insert("systemStats", { ...stats, createdAt: Date.now() });
    return null;
  },
});

// Hourly cron: keep 48 h of heartbeats.
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("systemStats")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - 48 * HOUR))
      .take(1000);
    for (const row of old) await ctx.db.delete(row._id);
    return old.length;
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("systemStats").withIndex("by_created").order("desc").first();
  },
});

// Heartbeats for the last `hours` hours (max 48), thinned to ~180 points.
export const history = query({
  args: { hours: v.number() },
  handler: async (ctx, { hours }) => {
    await requireAdmin(ctx);
    const span = Math.max(1, Math.min(48, hours));
    const rows = await ctx.db
      .query("systemStats")
      .withIndex("by_created", (q) => q.gte("createdAt", Date.now() - span * HOUR))
      .collect();
    const step = Math.max(1, Math.ceil(rows.length / 180));
    return rows
      .filter((_, i) => i % step === 0)
      .map((r) => ({
        t: r.createdAt,
        load: r.loadAvg1 / Math.max(1, r.cpuCount),
        mem: 1 - r.memAvailable / r.memTotal,
        busy: r.workerBusy,
      }));
  },
});

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

// Render queue + timing over the last 7 days (real and load-test renders).
export const renderStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const count = async (status: "queued" | "rendering") =>
      (await ctx.db.query("renders").withIndex("by_status", (q) => q.eq("status", status)).collect()).length;

    const since = Date.now() - 7 * 24 * HOUR;
    const finished = [
      ...(await ctx.db.query("renders").withIndex("by_status", (q) => q.eq("status", "done")).collect()),
      ...(await ctx.db.query("renders").withIndex("by_status", (q) => q.eq("status", "failed")).collect()),
    ].filter((r) => (r.finishedAt ?? r.updatedAt) >= since);

    const durations = finished
      .filter((r) => r.status === "done" && r.startedAt && r.finishedAt)
      .map((r) => (r.finishedAt! - r.startedAt!) / 1000)
      .sort((a, b) => a - b);

    const failures = finished
      .filter((r) => r.status === "failed")
      .sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt))
      .slice(0, 20)
      .map((r) => ({
        id: r._id,
        userId: r.userId,
        loadTest: !!r.loadTest,
        error: r.error,
        at: r.finishedAt ?? r.updatedAt,
      }));

    return {
      queued: await count("queued"),
      rendering: await count("rendering"),
      done7d: finished.filter((r) => r.status === "done").length,
      failed7d: failures.length,
      avgSeconds: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
      p95Seconds: percentile(durations, 95),
      timedRenders: durations.length,
      failures,
    };
  },
});
