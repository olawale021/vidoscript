import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Cap how much transcript we store/inject per sample.
const MAX_TRANSCRIPT_CHARS = 4000;
const DEFAULT_GROUP = "My style";

// A sample's named style. Older rows (pre-groups) fall back to their creator
// handle so nothing disappears; users can reassign from the Style Bank page.
function groupOf(doc: Doc<"styleSamples">): string {
  if (doc.styleGroup) return doc.styleGroup;
  return doc.creatorHandle ? `@${doc.creatorHandle}` : DEFAULT_GROUP;
}

export const add = mutation({
  args: {
    source: v.union(v.literal("upload"), v.literal("instagram"), v.literal("tiktok")),
    creatorHandle: v.union(v.string(), v.null()),
    styleGroup: v.optional(v.string()),
    title: v.string(),
    transcript: v.string(),
    structuredTranscript: v.optional(v.union(v.string(), v.null())),
    themes: v.optional(v.array(v.string())),
    hook: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const transcript = args.transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    return await ctx.db.insert("styleSamples", {
      userId: identity.subject,
      source: args.source,
      creatorHandle: args.creatorHandle ? args.creatorHandle.toLowerCase() : null,
      styleGroup: args.styleGroup?.trim() || DEFAULT_GROUP,
      title: args.title || "Untitled",
      transcript,
      structuredTranscript: args.structuredTranscript ?? null,
      themes: args.themes ?? [],
      hook: args.hook ?? null,
      wordCount: transcript.trim().split(/\s+/).filter(Boolean).length,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("styleSamples") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const sample = await ctx.db.get(id);
    if (!sample || sample.userId !== identity.subject) return null;
    await ctx.db.delete(id);
    return null;
  },
});

// Move a sample into a (possibly new) named style.
export const setGroup = mutation({
  args: { id: v.id("styleSamples"), styleGroup: v.string() },
  handler: async (ctx, { id, styleGroup }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const sample = await ctx.db.get(id);
    if (!sample || sample.userId !== identity.subject) return null;
    await ctx.db.patch(id, { styleGroup: styleGroup.trim() || DEFAULT_GROUP });
    return null;
  },
});

// Full list for the Style Bank management page.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("styleSamples")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      id: r._id,
      source: r.source,
      creatorHandle: r.creatorHandle,
      group: groupOf(r),
      title: r.title,
      wordCount: r.wordCount,
      themes: r.themes,
      preview: r.transcript.slice(0, 140),
      createdAt: r._creationTime,
    }));
  },
});

// Named styles with counts, for the generation dropdown and the page.
export const groups = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [] as { name: string; count: number }[];
    const rows = await ctx.db
      .query("styleSamples")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const counts = new Map<string, number>();
    for (const r of rows) {
      const g = groupOf(r);
      counts.set(g, (counts.get(g) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  },
});

// Samples to inject into a generation prompt, from one named style.
export const forGeneration = query({
  args: { group: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { group, limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const n = Math.min(limit ?? 4, 6);
    const rows = await ctx.db
      .query("styleSamples")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
    return rows
      .filter((r) => groupOf(r) === group)
      .slice(0, n)
      .map((r) => r.transcript);
  },
});
