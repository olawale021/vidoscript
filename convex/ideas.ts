import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ── Idea Bank ──
// Ideas are the backlog between "saw something inspiring" and "wrote a script".
// Statuses: idea → scripted (project created) → posted; archived is a soft delete.

const sourceValidator = v.union(
  v.literal("profile_outlier"),
  v.literal("angles"),
  v.literal("comments"),
  v.literal("hashtag"),
  v.literal("pillar"),
  v.literal("library"),
  v.literal("manual")
);

// Reactive list, newest activity first. Filter by status client-side — the
// backlog is small enough that one query keeps the chips instant.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const ideas = await ctx.db
      .query("ideas")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(500);

    return ideas.map((idea) => ({
      id: idea._id,
      topic: idea.topic,
      hook: idea.hook ?? null,
      notes: idea.notes ?? null,
      status: idea.status,
      source: idea.source,
      sourceCreatorHandle: idea.sourceCreatorHandle ?? null,
      sourceShortcode: idea.sourceShortcode ?? null,
      libraryItemId: idea.libraryItemId ?? null,
      projectId: idea.projectId ?? null,
      createdAt: idea._creationTime,
      updatedAt: idea.updatedAt,
    }));
  },
});

// Save an idea from any surface: manual quick-add today; profile outliers,
// angle generation, comment mining etc. pass their provenance later.
export const add = mutation({
  args: {
    topic: v.string(),
    hook: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    source: v.optional(sourceValidator),
    sourceCreatorHandle: v.optional(v.string()),
    sourceShortcode: v.optional(v.string()),
    libraryItemId: v.optional(v.id("libraryItems")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const topic = args.topic.trim();
    if (!topic) throw new Error("Idea topic is required");

    return await ctx.db.insert("ideas", {
      userId: identity.subject,
      topic,
      hook: args.hook ?? null,
      notes: args.notes ?? null,
      status: "idea",
      source: args.source ?? "manual",
      sourceCreatorHandle: args.sourceCreatorHandle,
      sourceShortcode: args.sourceShortcode,
      libraryItemId: args.libraryItemId,
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("ideas"),
    topic: v.optional(v.string()),
    hook: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const idea = await ctx.db.get(id);
    if (!idea || idea.userId !== identity.subject) throw new Error("Not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.topic !== undefined) {
      const topic = patch.topic.trim();
      if (!topic) throw new Error("Idea topic is required");
      updates.topic = topic;
    }
    if (patch.hook !== undefined) updates.hook = patch.hook;
    if (patch.notes !== undefined) updates.notes = patch.notes;
    await ctx.db.patch(id, updates);
    return null;
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("ideas"),
    status: v.union(
      v.literal("idea"),
      v.literal("scripted"),
      v.literal("posted"),
      v.literal("archived")
    ),
  },
  handler: async (ctx, { id, status }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const idea = await ctx.db.get(id);
    if (!idea || idea.userId !== identity.subject) throw new Error("Not found");
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("ideas") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const idea = await ctx.db.get(id);
    if (!idea || idea.userId !== identity.subject) return null;
    await ctx.db.delete(id);
    return null;
  },
});

// One-click idea → script: creates an idea-mode project (the workspace's
// pipeline skips transcription and analyzes the notes directly), links it
// back, and flips the idea to "scripted".
export const writeScript = mutation({
  args: { id: v.id("ideas") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const idea = await ctx.db.get(id);
    if (!idea || idea.userId !== identity.subject) throw new Error("Not found");
    if (idea.projectId) return idea.projectId; // already scripted — reopen it

    const parts = [idea.topic];
    if (idea.hook) parts.push(`Suggested hook: ${idea.hook}`);
    if (idea.notes) parts.push(`Notes: ${idea.notes}`);
    if (idea.sourceCreatorHandle) {
      parts.push(`(Inspired by @${idea.sourceCreatorHandle} — write an original take, don't copy.)`);
    }

    const firstWords = idea.topic.split(/\s+/).slice(0, 6).join(" ");
    const projectId = await ctx.db.insert("projects", {
      userId: identity.subject,
      title: firstWords.length < idea.topic.length ? `${firstWords}…` : firstWords,
      transcript: parts.join("\n\n"),
      segments: [],
      analysis: {},
      script: "",
      chat: [],
      tone: null,
      model: "gpt4o",
      userPrompt: null,
      status: "processing",
      progressStep: "analyzing",
      error: null,
      updatedAt: Date.now(),
    });

    await ctx.db.patch(id, {
      status: "scripted",
      projectId,
      updatedAt: Date.now(),
    });
    return projectId;
  },
});
