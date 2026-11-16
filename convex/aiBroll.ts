import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Helpers for AI B-roll shots (convex/aiBrollNode.ts does the Higgsfield calls).

export const clipForUser = internalQuery({
  args: { clipId: v.id("clips"), userId: v.string() },
  handler: async (ctx, { clipId, userId }) => {
    const clip = await ctx.db.get(clipId);
    if (!clip || clip.userId !== userId) return null;
    return { aspect: clip.aspect ?? "9:16", smart: clip.smart ?? null, userId: clip.userId };
  },
});

// Patch one B-roll item inside clips.smart (by id).
export const patchBroll = internalMutation({
  args: { clipId: v.id("clips"), brollId: v.string(), patch: v.any() },
  handler: async (ctx, { clipId, brollId, patch }) => {
    const clip = await ctx.db.get(clipId);
    if (!clip?.smart) return null;
    const smart = clip.smart as { broll: { id: string; ai?: Record<string, unknown> }[] };
    const broll = smart.broll.map((b) => {
      if (b.id !== brollId) return b;
      const p = patch as { ai?: Record<string, unknown> } & Record<string, unknown>;
      return { ...b, ...p, ...(p.ai ? { ai: { ...(b.ai ?? {}), ...p.ai } } : {}) };
    });
    await ctx.db.patch(clipId, { smart: { ...clip.smart, broll } });
    return null;
  },
});
