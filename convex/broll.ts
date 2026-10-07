import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ── User-facing (Clerk-auth) ──

// Save/replace the scene plan for a project. One render row per project.
export const saveScenePlan = mutation({
  args: { projectId: v.id("projects"), scenePlan: v.any() },
  handler: async (ctx, { projectId, scenePlan }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const project = await ctx.db.get(projectId);
    if (!project || project.userId !== identity.subject) throw new Error("Not found");

    const existing = await ctx.db
      .query("renders")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { scenePlan, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("renders", {
      userId: identity.subject,
      projectId,
      scenePlan,
      status: "draft",
      progress: 0,
      error: null,
      jobToken: null,
      updatedAt: Date.now(),
    });
  },
});

// Reactive render state for a project (plan + status + output URL).
export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const render = await ctx.db
      .query("renders")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();
    if (!render || render.userId !== identity.subject) return null;

    const outputUrl = render.outputStorageId
      ? await ctx.storage.getUrl(render.outputStorageId)
      : null;
    return { ...render, outputUrl };
  },
});

// Queue the current plan for rendering.
export const enqueueRender = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const render = await ctx.db
      .query("renders")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();
    if (!render || render.userId !== identity.subject) throw new Error("No plan to render");

    await ctx.db.patch(render._id, {
      status: "queued",
      progress: 0,
      error: null,
      updatedAt: Date.now(),
    });
    return render._id;
  },
});

// ── Worker-facing (shared secret, no Clerk session) ──

function assertWorker(secret: string) {
  const expected = process.env.BROLL_WORKER_SECRET;
  if (!expected || secret !== expected) throw new Error("Bad worker secret");
}

export const listQueued = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    const rows = await ctx.db
      .query("renders")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(5);
    return rows.map((r) => ({ id: r._id, scenePlan: r.scenePlan }));
  },
});

export const markRendering = mutation({
  args: { secret: v.string(), renderId: v.id("renders"), progress: v.number() },
  handler: async (ctx, { secret, renderId, progress }) => {
    assertWorker(secret);
    await ctx.db.patch(renderId, { status: "rendering", progress, updatedAt: Date.now() });
    return null;
  },
});

export const generateOutputUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    assertWorker(secret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveOutput = mutation({
  args: {
    secret: v.string(),
    renderId: v.id("renders"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { secret, renderId, storageId }) => {
    assertWorker(secret);
    await ctx.db.patch(renderId, {
      status: "done",
      progress: 100,
      outputStorageId: storageId,
      error: null,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markFailed = mutation({
  args: { secret: v.string(), renderId: v.id("renders"), error: v.string() },
  handler: async (ctx, { secret, renderId, error }) => {
    assertWorker(secret);
    await ctx.db.patch(renderId, { status: "failed", error, updatedAt: Date.now() });
    return null;
  },
});
