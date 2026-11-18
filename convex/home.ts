import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { r2, SIX_HOURS } from "./r2";

// Dashboard home: one merged "recent work" feed (scripts, clip videos,
// stories) and this month's numbers. Read-only.

export type HomeKind = "script" | "clip" | "story";
export type HomeState = "ready" | "processing" | "failed" | "action";

export type HomeItem = {
  kind: HomeKind;
  id: string;
  title: string;
  sub: string; // e.g. "112 words" / "6 clips" / "8 scenes"
  durationSec: number | null;
  thumbUrl: string | null;
  state: HomeState;
  stateLabel: string | null; // "Transcribing", "Couldn't download"…
  progress: number | null; // 0..100 when known
  excerpt: string | null;
  updatedAt: number;
};

const PER_KIND = 16;

function words(text: string | undefined | null): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

function excerptOf(text: string | undefined | null, max = 220): string | null {
  const t = (text ?? "")
    .replace(/[#*_>`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function projectItem(p: Doc<"projects">): HomeItem {
  const status = p.status ?? "ready";
  const last = p.segments[p.segments.length - 1];
  const wc = words(p.script);
  return {
    kind: "script",
    id: p._id,
    title: p.title || "Untitled script",
    sub: status === "ready" ? `${wc.toLocaleString()} words` : status === "failed" ? "Failed" : "In progress",
    durationSec: last ? last.end : null,
    thumbUrl: null,
    state: status,
    stateLabel: status === "processing" ? cap(p.progressStep || "Processing") : status === "failed" ? "Couldn't finish" : null,
    progress: null,
    excerpt: excerptOf(p.script),
    updatedAt: p.updatedAt,
  };
}

async function clipSourceItem(ctx: QueryCtx, s: Doc<"clipSources">): Promise<HomeItem> {
  let state: HomeState = "ready";
  let stateLabel: string | null = null;
  let sub = "";
  switch (s.status) {
    case "failed":
      state = "failed";
      stateLabel = s.sourceType === "url" ? "Couldn't download" : "Couldn't process";
      sub = "Failed";
      break;
    case "confirm":
      state = "action";
      stateLabel = "Approve download";
      sub = "Waiting for you";
      break;
    case "uploading":
    case "checking":
    case "queued":
    case "processing":
      state = "processing";
      stateLabel =
        s.status === "uploading" ? "Uploading" : s.status === "checking" ? "Checking link" : s.status === "queued" ? "Queued" : cap(s.step ?? "processing");
      sub = "Processing";
      break;
    default: {
      const clips = await ctx.db
        .query("clips")
        .withIndex("by_source", (q) => q.eq("sourceId", s._id))
        .take(200);
      const n = clips.filter((c) => !c.hidden).length;
      sub = `${n} clip${n === 1 ? "" : "s"}`;
    }
  }
  return {
    kind: "clip",
    id: s._id,
    title: s.title || "Untitled video",
    sub,
    durationSec: s.durationSec ?? null,
    thumbUrl: s.thumbnailUrl ?? null,
    state,
    stateLabel,
    progress: state === "processing" ? s.progress : null,
    excerpt: s.channelName ? `From ${s.channelName}` : null,
    updatedAt: s.updatedAt,
  };
}

async function storyItem(ctx: QueryCtx, s: Doc<"stories">): Promise<HomeItem> {
  const shots = await ctx.db
    .query("storyShots")
    .withIndex("by_story", (q) => q.eq("storyId", s._id))
    .take(200);
  const firstKey = shots.find((x) => x.stillKey)?.stillKey ?? null;
  const audio = shots.reduce((sum, x) => sum + (x.audioSec ?? 0), 0);
  let state: HomeState = "ready";
  let stateLabel: string | null = null;
  if (s.renderStatus === "queued" || s.renderStatus === "rendering") {
    state = "processing";
    stateLabel = "Rendering";
  } else if (s.renderStatus === "failed") {
    state = "failed";
    stateLabel = "Render failed";
  } else if (s.error) {
    state = "failed";
    stateLabel = "Needs attention";
  }
  const stepLabel: Record<Doc<"stories">["step"], string> = {
    script: "Script",
    plan: "Plan",
    cast: "Cast",
    board: "Storyboard",
    export: "Export",
  };
  return {
    kind: "story",
    id: s._id,
    title: s.title || "Untitled story",
    sub: shots.length ? `${shots.length} scene${shots.length === 1 ? "" : "s"}` : stepLabel[s.step],
    durationSec: audio > 0 ? audio : s.targetSec,
    thumbUrl: firstKey ? await r2.getUrl(firstKey, { expiresIn: SIX_HOURS }) : null,
    state,
    stateLabel,
    progress: state === "processing" ? s.renderProgress ?? null : null,
    excerpt: excerptOf(s.hook || s.script || s.idea),
    updatedAt: s.updatedAt,
  };
}

// Newest work across scripts, clip videos and stories.
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<HomeItem[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject;
    const n = Math.min(Math.max(limit ?? PER_KIND, 1), 40);

    const [projects, sources, stories] = await Promise.all([
      ctx.db.query("projects").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(n),
      ctx.db.query("clipSources").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(n),
      // Stories are indexed by createdAt; take a few extra so recently edited
      // older stories still have a chance to make the cut.
      ctx.db.query("stories").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(n * 2),
    ]);

    // Pick the newest n before doing per-item work (clip counts, signed URLs).
    const merged = [
      ...projects.map((d) => ({ t: d.updatedAt, k: "script" as const, d })),
      ...sources.map((d) => ({ t: d.updatedAt, k: "clip" as const, d })),
      ...stories.map((d) => ({ t: d.updatedAt, k: "story" as const, d })),
    ]
      .sort((a, b) => b.t - a.t)
      .slice(0, n);

    return await Promise.all(
      merged.map((m) =>
        m.k === "script"
          ? Promise.resolve(projectItem(m.d as Doc<"projects">))
          : m.k === "clip"
          ? clipSourceItem(ctx, m.d as Doc<"clipSources">)
          : storyItem(ctx, m.d as Doc<"stories">)
      )
    );
  },
});

// Counts since `since` (the client's start of the month). Only numbers we
// can compute exactly.
export const monthStats = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject;

    const [projects, sourcesThisMonth, allSources, stories, usage] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_user", (q) => q.eq("userId", userId).gte("updatedAt", since))
        .collect(),
      ctx.db
        .query("clipSources")
        .withIndex("by_user", (q) => q.eq("userId", userId).gte("updatedAt", since))
        .collect(),
      ctx.db.query("clipSources").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(300),
      ctx.db
        .query("stories")
        .withIndex("by_user", (q) => q.eq("userId", userId).gte("createdAt", since))
        .collect(),
      ctx.db
        .query("aiUsage")
        .withIndex("by_user_created", (q) => q.eq("userId", userId).gte("createdAt", since))
        .collect(),
    ]);

    // Exported clips: rendered MP4s finished this month.
    let clipsExported = 0;
    for (const s of allSources) {
      const clips = await ctx.db
        .query("clips")
        .withIndex("by_source", (q) => q.eq("sourceId", s._id))
        .take(300);
      for (const c of clips) {
        if (c.renderStatus === "done" && (c.renderFinishedAt ?? 0) >= since) clipsExported++;
      }
    }

    let audioSeconds = 0;
    for (const u of usage) {
      if (!u.audioSeconds) continue;
      if (u.provider === "groq" || /whisper/i.test(u.model)) audioSeconds += u.audioSeconds;
    }

    let wordsWritten = 0;
    const newProjects = projects.filter((p) => p._creationTime >= since);
    for (const p of newProjects) wordsWritten += words(p.script);

    return {
      projects: newProjects.length,
      wordsWritten,
      clipVideos: sourcesThisMonth.filter((s) => s._creationTime >= since).length,
      clipsExported,
      stories: stories.length,
      minutesTranscribed: Math.round(audioSeconds / 60),
    };
  },
});
