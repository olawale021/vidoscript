import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { extFromName, fileUrl, r2, storagePrefix } from "./r2";

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Signed R2 URL the browser PUTs the raw video to. Returns the object key to
// pass to createDraft.
export const generateUploadUrl = mutation({
  args: { fileName: v.optional(v.string()), contentType: v.optional(v.string()) },
  handler: async (ctx, { fileName, contentType }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const key = `${storagePrefix()}/uploads/${identity.subject}/${crypto.randomUUID()}.${extFromName(fileName, contentType)}`;
    const { url } = await r2.generateUploadUrl(key);
    return { url, key };
  },
});

// Create a project the moment work starts (upload time), before any pipeline
// output exists. The workspace page drives the pipeline and fills fields in.
export const createDraft = mutation({
  args: {
    title: v.string(),
    videoStorageId: v.optional(v.id("_storage")),
    videoKey: v.optional(v.string()),
    idea: v.optional(v.string()), // topic / rough notes — no video needed
    userPrompt: v.optional(v.union(v.string(), v.null())),
    model: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (args.videoKey && !args.videoKey.startsWith(`${storagePrefix()}/uploads/${identity.subject}/`)) {
      throw new Error("Invalid upload");
    }
    const isIdea = !args.videoStorageId && !args.videoKey && !!args.idea?.trim();
    return await ctx.db.insert("projects", {
      userId: identity.subject,
      title: args.title || "Untitled",
      // Idea projects store the notes as the source text; the pipeline skips
      // transcription and goes straight to analyzing the notes.
      transcript: isIdea ? args.idea!.trim() : "",
      segments: [],
      analysis: {},
      script: "",
      chat: [],
      tone: null,
      model: args.model ?? null,
      userPrompt: args.userPrompt ?? null,
      videoStorageId: args.videoStorageId,
      videoKey: args.videoKey,
      status: "processing",
      progressStep: isIdea ? "analyzing" : "transcribing",
      error: null,
      updatedAt: Date.now(),
    });
  },
});

// Flexible pipeline patch: the workspace saves each stage's output as it lands.
export const savePipeline = mutation({
  args: {
    id: v.id("projects"),
    transcript: v.optional(v.string()),
    segments: v.optional(
      v.array(v.object({ start: v.number(), end: v.number(), text: v.string() }))
    ),
    analysis: v.optional(v.any()),
    script: v.optional(v.string()),
    progressStep: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("processing"), v.literal("ready"), v.literal("failed"))
    ),
    error: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const project = await ctx.db.get(id);
    if (!project || project.userId !== identity.subject) throw new Error("Not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) updates[k] = val;
    }
    await ctx.db.patch(id, updates);
    return null;
  },
});

// Reactive list of the current user's projects (summaries), newest first.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(50);

    return await Promise.all(
      projects.map(async (p) => ({
        id: p._id,
        title: p.title,
        wordCount: wordCount(p.transcript),
        status: p.status ?? "ready",
        progressStep: p.progressStep ?? null,
        videoUrl: await fileUrl(ctx, { key: p.videoKey, storageId: p.videoStorageId }),
        createdAt: p._creationTime,
        updatedAt: p.updatedAt,
      }))
    );
  },
});

// Aggregate stats for the dashboard overview.
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const renders = await ctx.db
      .query("renders")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const samples = await ctx.db
      .query("styleSamples")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    let wordsWritten = 0;
    let secondsTranscribed = 0;
    for (const p of projects) {
      wordsWritten += wordCount(p.script);
      const last = p.segments[p.segments.length - 1];
      if (last) secondsTranscribed += last.end;
    }

    return {
      projects: projects.length,
      wordsWritten,
      minutesTranscribed: Math.round(secondsTranscribed / 60),
      rendersDone: renders.filter((r) => r.status === "done").length,
      styleSamples: samples.length,
    };
  },
});

// Full project by id (owner-scoped).
export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const project = await ctx.db.get(id);
    if (!project || project.userId !== identity.subject) return null;

    // Resolve a playable URL for the stored video (if any)
    const videoUrl = await fileUrl(ctx, { key: project.videoKey, storageId: project.videoStorageId });

    return { ...project, videoUrl, hasVideo: !!(project.videoKey || project.videoStorageId) };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    transcript: v.string(),
    segments: v.array(
      v.object({ start: v.number(), end: v.number(), text: v.string() })
    ),
    analysis: v.any(),
    script: v.string(),
    chat: v.optional(
      v.array(v.object({ role: v.string(), content: v.string() }))
    ),
    tone: v.optional(v.union(v.string(), v.null())),
    model: v.optional(v.union(v.string(), v.null())),
    userPrompt: v.optional(v.union(v.string(), v.null())),
    videoStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await ctx.db.insert("projects", {
      userId: identity.subject,
      title: args.title || "Untitled",
      transcript: args.transcript,
      segments: args.segments,
      analysis: args.analysis,
      script: args.script,
      chat: args.chat ?? [],
      tone: args.tone ?? null,
      model: args.model ?? null,
      userPrompt: args.userPrompt ?? null,
      videoStorageId: args.videoStorageId,
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    title: v.optional(v.string()),
    script: v.optional(v.string()),
    chat: v.optional(
      v.array(v.object({ role: v.string(), content: v.string() }))
    ),
    tone: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const project = await ctx.db.get(id);
    if (!project || project.userId !== identity.subject) {
      throw new Error("Not found");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.script !== undefined) updates.script = patch.script;
    if (patch.chat !== undefined) updates.chat = patch.chat;
    if (patch.tone !== undefined) updates.tone = patch.tone;

    await ctx.db.patch(id, updates);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const project = await ctx.db.get(id);
    if (!project || project.userId !== identity.subject) return null;

    await ctx.db.delete(id);
    return null;
  },
});
