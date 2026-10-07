import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Script projects / history (per Clerk user)
  projects: defineTable({
    userId: v.string(), // Clerk subject (identity.subject)
    title: v.string(),
    transcript: v.string(),
    segments: v.array(
      v.object({
        start: v.number(),
        end: v.number(),
        text: v.string(),
      })
    ),
    analysis: v.any(),
    script: v.string(),
    chat: v.array(
      v.object({
        role: v.string(),
        content: v.string(),
      })
    ),
    tone: v.union(v.string(), v.null()),
    model: v.union(v.string(), v.null()),
    userPrompt: v.union(v.string(), v.null()),
    videoStorageId: v.optional(v.id("_storage")),
    libraryItemId: v.optional(v.id("libraryItems")), // set when created from a library video
    // Lifecycle: a project exists from upload. Missing status (older rows) = ready.
    status: v.optional(
      v.union(v.literal("processing"), v.literal("ready"), v.literal("failed"))
    ),
    progressStep: v.optional(v.string()), // "transcribing" | "analyzing" | "generating"
    error: v.optional(v.union(v.string(), v.null())),
    updatedAt: v.number(),
  }).index("by_user", ["userId", "updatedAt"]),

  // Media library: videos the user saved as raw material (imported from
  // Instagram or uploaded). A project is optionally created *from* an item —
  // the item owns the stored bytes; projects reference the same storageId.
  libraryItems: defineTable({
    userId: v.string(), // Clerk subject
    source: v.union(v.literal("upload"), v.literal("instagram"), v.literal("tiktok")),
    // Set once the background import finishes (status flips to "ready").
    storageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
    sourceUrl: v.optional(v.string()), // the post URL the user pasted / canonical link
    shortcode: v.optional(v.string()), // IG shortcode — dedup key + lets retries re-resolve a fresh CDN URL
    creatorHandle: v.optional(v.string()),
    caption: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    fileSizeBytes: v.optional(v.number()),
    status: v.union(v.literal("importing"), v.literal("ready"), v.literal("failed")),
    error: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_user", ["userId"])
    .index("by_user_shortcode", ["userId", "shortcode"]),

  // Idea Bank: a statused backlog of content topics. Every ideation surface
  // (profile outliers, angle generation, comment mining, …) writes here with
  // provenance; the script pipeline reads out of it via writeScript.
  ideas: defineTable({
    userId: v.string(), // Clerk subject
    topic: v.string(),
    hook: v.optional(v.union(v.string(), v.null())), // suggested opener line
    notes: v.optional(v.union(v.string(), v.null())),
    status: v.union(
      v.literal("idea"),
      v.literal("scripted"),
      v.literal("posted"),
      v.literal("archived")
    ),
    source: v.union(
      v.literal("profile_outlier"),
      v.literal("angles"),
      v.literal("comments"),
      v.literal("hashtag"),
      v.literal("pillar"),
      v.literal("library"),
      v.literal("manual")
    ),
    // Provenance (all optional — manual ideas have none)
    sourceCreatorHandle: v.optional(v.string()),
    sourceShortcode: v.optional(v.string()),
    libraryItemId: v.optional(v.id("libraryItems")),
    projectId: v.optional(v.id("projects")), // set when scripted
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_status", ["userId", "status"]),

  // ── Instagram cache (global, not user-scoped) ──

  igUsers: defineTable({
    username: v.string(), // lowercase, unique key
    userId: v.string(), // Instagram pk (stored as string to avoid 64-bit precision loss)
    fullName: v.optional(v.string()),
    isPrivate: v.boolean(),
    profilePicUrl: v.optional(v.string()),
    isVerified: v.boolean(),
    biography: v.optional(v.string()),
    followerCount: v.number(),
    followingCount: v.number(),
    mediaCount: v.number(),
    category: v.union(v.string(), v.null()),
    externalUrl: v.union(v.string(), v.null()),
    hdProfilePicUrl: v.union(v.string(), v.null()),
    cachedAt: v.number(),
  })
    .index("by_username", ["username"])
    .index("by_userId", ["userId"]),

  igPosts: defineTable({
    postId: v.string(), // Instagram post id, unique
    pk: v.string(),
    userId: v.string(),
    mediaType: v.number(),
    takenAt: v.number(),
    captionText: v.union(v.string(), v.null()),
    likeCount: v.number(),
    commentCount: v.number(),
    data: v.any(), // full InstagramPost JSON
    cachedAt: v.number(),
  })
    .index("by_postId", ["postId"])
    .index("by_user_taken", ["userId", "takenAt"]),

  igFavoriteCreators: defineTable({
    username: v.string(), // lowercase
  }).index("by_username", ["username"]),

  // Style Bank: real transcripts (the user's own videos + creators they want to
  // sound like) used as writing-style exemplars during script generation.
  styleSamples: defineTable({
    userId: v.string(), // Clerk subject
    source: v.union(v.literal("upload"), v.literal("instagram"), v.literal("tiktok")),
    creatorHandle: v.union(v.string(), v.null()), // attribution only (who said it)
    styleGroup: v.optional(v.string()), // named style this sample belongs to ("My style", ...)
    title: v.string(), // short label for the list UI
    transcript: v.string(),
    structuredTranscript: v.union(v.string(), v.null()),
    themes: v.array(v.string()),
    hook: v.union(v.string(), v.null()), // extracted opener, for the hook bank
    wordCount: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_creator", ["userId", "creatorHandle"]),

  // B-roll scene plans + render jobs (one row per project; holds the current plan
  // and the latest render state).
  renders: defineTable({
    userId: v.string(),
    projectId: v.id("projects"),
    scenePlan: v.any(), // ScenePlan JSON (see types/broll.ts)
    status: v.union(
      v.literal("draft"),
      v.literal("queued"),
      v.literal("rendering"),
      v.literal("done"),
      v.literal("failed"),
    ),
    progress: v.number(), // 0..100
    outputStorageId: v.optional(v.id("_storage")),
    error: v.union(v.string(), v.null()),
    jobToken: v.union(v.string(), v.null()), // shared secret for worker callbacks
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_status", ["status"]),
});
