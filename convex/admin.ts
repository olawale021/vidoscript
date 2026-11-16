import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { r2 } from "./r2";

// ── Admin identity ──
// Admins are listed in Convex env:
//   ADMIN_USER_IDS  comma-separated Clerk user ids (reliable: the token always has `subject`)
//   ADMIN_EMAILS    comma-separated emails (used only if the Clerk token carries `email`)
// Future plan/usage limits should call `isAdminCtx(ctx)` and skip the limit for admins.

function envList(name: string, lower = false): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
}

export async function isAdminCtx(ctx: QueryCtx): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return false;
  if (envList("ADMIN_USER_IDS").includes(identity.subject)) return true;
  const email = typeof identity.email === "string" ? identity.email.toLowerCase() : null;
  return !!email && envList("ADMIN_EMAILS", true).includes(email);
}

export async function requireAdmin(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !(await isAdminCtx(ctx))) throw new Error("Forbidden");
  return identity;
}

export const amIAdmin = query({
  args: {},
  handler: async (ctx) => isAdminCtx(ctx),
});

// ── Load tests ──
// Copies of the admin's most recent real render plan, queued for the worker.
// They share the source projectId but carry loadTest: true, so the project
// page (convex/broll.ts primaryRender) never shows them.

export const loadTestStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("renders")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(500);
    const source = rows.find(
      (r) => !r.loadTest && Array.isArray(r.scenePlan?.scenes) && r.scenePlan.scenes.length > 0
    );
    const tests = rows.filter((r) => r.loadTest);
    const count = (s: string) => tests.filter((r) => r.status === s).length;
    return {
      source: source
        ? { id: source._id, scenes: source.scenePlan.scenes.length as number, updatedAt: source.updatedAt }
        : null,
      total: tests.length,
      queued: count("queued"),
      rendering: count("rendering"),
      done: count("done"),
      failed: count("failed"),
      recent: tests.slice(0, 20).map((r) => ({
        id: r._id,
        status: r.status,
        progress: r.progress,
        startedAt: r.startedAt ?? null,
        finishedAt: r.finishedAt ?? null,
        error: r.error,
      })),
    };
  },
});

export const queueTestRenders = mutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    const identity = await requireAdmin(ctx);
    const n = Math.max(1, Math.min(10, Math.floor(count)));
    const rows = await ctx.db
      .query("renders")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(200);
    const source = rows.find(
      (r) => !r.loadTest && Array.isArray(r.scenePlan?.scenes) && r.scenePlan.scenes.length > 0
    );
    if (!source) throw new Error("Make a B-roll plan in one of your projects first");

    const now = Date.now();
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("renders", {
        userId: identity.subject,
        projectId: source.projectId,
        scenePlan: source.scenePlan,
        status: "queued",
        progress: 0,
        error: null,
        jobToken: null,
        loadTest: true,
        updatedAt: now,
      });
    }
    return n;
  },
});

export const clearTestRenders = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("renders")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    let removed = 0;
    for (const r of rows) {
      // Leave in-flight jobs alone; the worker still holds them.
      if (!r.loadTest || r.status === "rendering") continue;
      if (r.outputStorageId) await ctx.storage.delete(r.outputStorageId);
      if (r.outputKey) await r2.deleteObject(ctx, r.outputKey).catch(() => {});
      await ctx.db.delete(r._id);
      removed++;
    }
    return removed;
  },
});

// ── Users ──

type UserRow = {
  userId: string;
  projects: number;
  renders: number;
  failedRenders: number;
  libraryItems: number;
  aiCalls: number;
  aiCostUsd: number;
  lastActive: number;
};

export const users = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const map = new Map<string, UserRow>();
    const row = (userId: string) => {
      let r = map.get(userId);
      if (!r) {
        r = { userId, projects: 0, renders: 0, failedRenders: 0, libraryItems: 0, aiCalls: 0, aiCostUsd: 0, lastActive: 0 };
        map.set(userId, r);
      }
      return r;
    };
    for (const p of await ctx.db.query("projects").collect()) {
      const r = row(p.userId);
      r.projects++;
      r.lastActive = Math.max(r.lastActive, p.updatedAt);
    }
    for (const x of await ctx.db.query("renders").collect()) {
      if (x.loadTest) continue;
      const r = row(x.userId);
      r.renders++;
      if (x.status === "failed") r.failedRenders++;
      r.lastActive = Math.max(r.lastActive, x.updatedAt);
    }
    for (const l of await ctx.db.query("libraryItems").collect()) {
      const r = row(l.userId);
      r.libraryItems++;
      r.lastActive = Math.max(r.lastActive, l._creationTime);
    }
    for (const u of await ctx.db.query("aiUsage").collect()) {
      const r = row(u.userId);
      r.aiCalls++;
      r.aiCostUsd += u.costUsd;
      r.lastActive = Math.max(r.lastActive, u.createdAt);
    }
    return [...map.values()].sort((a, b) => b.lastActive - a.lastActive);
  },
});

export const userDetail = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await requireAdmin(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const renders = await ctx.db
      .query("renders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const library = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    const usage = await ctx.db
      .query("aiUsage")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1000);
    return {
      projects: projects.map((p) => ({
        id: p._id,
        title: p.title,
        status: p.status ?? "ready",
        error: p.error ?? null,
        updatedAt: p.updatedAt,
      })),
      renders: renders
        .filter((r) => !r.loadTest)
        .map((r) => ({
          id: r._id,
          projectId: r.projectId,
          status: r.status,
          error: r.error,
          startedAt: r.startedAt ?? null,
          finishedAt: r.finishedAt ?? null,
          updatedAt: r.updatedAt,
        })),
      library: library.map((l) => ({
        id: l._id,
        source: l.source,
        status: l.status,
        creatorHandle: l.creatorHandle ?? null,
        error: l.error ?? null,
        createdAt: l._creationTime,
      })),
      ai: {
        calls: usage.length,
        costUsd: usage.reduce((s, u) => s + u.costUsd, 0),
        recent: usage.slice(0, 20).map((u) => ({
          feature: u.feature,
          model: u.model,
          costUsd: u.costUsd,
          createdAt: u.createdAt,
        })),
      },
    };
  },
});
