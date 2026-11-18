import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { FeedbackStage } from "../types/story";

// Story Studio feedback. Explicit 👍/👎 + reasons from the UI, plus implicit
// signals (rewrite notes, redraws, voice changes) recorded by convex/stories.ts.
// convex/storyWorker.ts turns recent rows into prompt guidance (prefsFor).

const stageV = v.union(v.literal("script"), v.literal("plan"), v.literal("still"), v.literal("motion"), v.literal("voice"), v.literal("video"));
const STAGES: FeedbackStage[] = ["script", "plan", "still", "motion", "voice", "video"];

async function requireUser(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

// What was rated, kept as text so later prompts can show examples.
async function snapshotFor(ctx: QueryCtx, story: Doc<"stories">, stage: FeedbackStage, targetId?: string) {
  if (stage === "script") {
    const lines = (story.script ?? "").split("\n").filter((l) => l.trim() && !/^(TITLE|HOOK):/.test(l)).slice(0, 4);
    return `Title: ${story.title}\nHook: ${story.hook ?? ""}\n${lines.join("\n")}`.slice(0, 700);
  }
  if (stage === "plan" || stage === "video") {
    const shots = await ctx.db.query("storyShots").withIndex("by_story", (q) => q.eq("storyId", story._id)).collect();
    const cams = shots.map((s) => s.camera).join(", ");
    return `${story.title} · ${story.targetSec}s target · ${shots.length} shots · style ${story.style} · cameras: ${cams}`.slice(0, 500);
  }
  const shot = targetId ? await ctx.db.get(targetId as Id<"storyShots">) : null;
  if (!shot) return undefined;
  if (stage === "motion") return `motion: ${(shot.motionPrompt ?? "").slice(0, 400)}`;
  if (stage === "voice") {
    const bible = story.bible as { characters?: { id: string; voice: string }[] } | undefined;
    const voice = bible?.characters?.find((c) => c.id === shot.speaker)?.voice ?? story.narratorVoice;
    return `voice:${voice} | "${shot.narration.slice(0, 160)}"`;
  }
  return shot.imagePrompt.slice(0, 500);
}

export async function recordImplicit(
  ctx: MutationCtx,
  row: {
    userId: string;
    storyId: Id<"stories">;
    stage: FeedbackStage;
    targetId?: string;
    rating: number;
    reasons: string[];
    note?: string;
    snapshot?: string;
  }
) {
  await ctx.db.insert("storyFeedback", { ...row, implicit: true, createdAt: Date.now() });
}

export const rate = mutation({
  args: {
    storyId: v.id("stories"),
    stage: stageV,
    targetId: v.optional(v.string()),
    rating: v.number(),
    reasons: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { storyId, stage, targetId, rating, reasons, note }) => {
    const userId = await requireUser(ctx);
    const story = await ctx.db.get(storyId);
    if (!story || story.userId !== userId) throw new Error("Not found");
    const existing = (
      await ctx.db
        .query("storyFeedback")
        .withIndex("by_target", (q) => q.eq("storyId", storyId).eq("stage", stage).eq("targetId", targetId))
        .collect()
    ).find((r) => !r.implicit);
    const clean = {
      rating: rating > 0 ? 1 : rating < 0 ? -1 : 0,
      reasons: reasons.slice(0, 8).map((r) => r.slice(0, 40)),
      note: note?.trim().slice(0, 300) || undefined,
    };
    if (clean.rating === 0 && clean.reasons.length === 0 && !clean.note) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    const snapshot = await snapshotFor(ctx, story, stage, targetId);
    if (existing) await ctx.db.patch(existing._id, { ...clean, snapshot, createdAt: Date.now() });
    else await ctx.db.insert("storyFeedback", { userId, storyId, stage, targetId, ...clean, snapshot, implicit: false, createdAt: Date.now() });
    return null;
  },
});

// The creator's own ratings on one story (to show filled thumbs).
export const forStory = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {};
    const story = await ctx.db.get(storyId);
    if (!story || story.userId !== identity.subject) return {};
    const out: Record<string, { rating: number; reasons: string[]; note: string | null }> = {};
    for (const stage of STAGES) {
      const rows = await ctx.db
        .query("storyFeedback")
        .withIndex("by_target", (q) => q.eq("storyId", storyId).eq("stage", stage))
        .collect();
      for (const r of rows) {
        if (!r.implicit) out[`${stage}:${r.targetId ?? ""}`] = { rating: r.rating, reasons: r.reasons, note: r.note ?? null };
      }
    }
    return out;
  },
});

// Recent feedback per stage (all stories), newest first.
export async function recentFeedback(ctx: QueryCtx, userId: string, stage: FeedbackStage, limit = 60) {
  return await ctx.db
    .query("storyFeedback")
    .withIndex("by_user_stage", (q) => q.eq("userId", userId).eq("stage", stage))
    .order("desc")
    .take(limit);
}

function favouriteVoice(rows: Doc<"storyFeedback">[]) {
  const score: Record<string, number> = {};
  for (const r of rows) {
    const id = r.snapshot?.match(/^voice:([a-z]+)/)?.[1];
    if (id) score[id] = (score[id] ?? 0) + (r.rating || 0);
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

// "What the AI has learned" panel.
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    let total = 0;
    const stages: Record<string, { up: number; down: number; notes: number; top: { reason: string; count: number }[] }> = {};
    let voiceRows: Doc<"storyFeedback">[] = [];
    for (const stage of STAGES) {
      const rows = await recentFeedback(ctx, identity.subject, stage, 200);
      if (stage === "voice") voiceRows = rows;
      total += rows.length;
      const counts: Record<string, number> = {};
      for (const r of rows) for (const reason of r.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
      stages[stage] = {
        up: rows.filter((r) => r.rating > 0).length,
        down: rows.filter((r) => r.rating < 0).length,
        notes: rows.filter((r) => r.note).length,
        top: Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([reason, count]) => ({ reason, count })),
      };
    }
    return { total, stages, favouriteVoice: favouriteVoice(voiceRows) };
  },
});

export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    for (const stage of STAGES) {
      const rows = await ctx.db
        .query("storyFeedback")
        .withIndex("by_user_stage", (q) => q.eq("userId", userId).eq("stage", stage))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
    return null;
  },
});
