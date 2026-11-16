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
    videoStorageId: v.optional(v.id("_storage")), // pre-R2 uploads
    videoKey: v.optional(v.string()), // R2 object key (new uploads)
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
    storageId: v.optional(v.id("_storage")), // pre-R2 imports
    thumbnailStorageId: v.optional(v.id("_storage")),
    videoKey: v.optional(v.string()), // R2 object keys (new imports)
    thumbnailKey: v.optional(v.string()),
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
    outputStorageId: v.optional(v.id("_storage")), // pre-R2 renders
    outputKey: v.optional(v.string()), // R2 object key
    error: v.union(v.string(), v.null()),
    jobToken: v.union(v.string(), v.null()), // shared secret for worker callbacks
    updatedAt: v.number(),
    // Timing for capacity stats (set by the worker callbacks).
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    // Admin load-test copy: shares the source projectId but is never shown to the user.
    loadTest: v.optional(v.boolean()),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_status", ["status"]),

  // ── Clipping ──
  // A long video the user uploaded to be cut into short clips. The video
  // lives in R2 (videoKey); the worker extracts audio, transcribes it and asks
  // the AI for the best moments.
  clipSources: defineTable({
    userId: v.string(), // Clerk subject
    title: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    sizeBytes: v.number(),
    videoKey: v.string(), // R2 object key
    // Pasted link (YouTube) instead of an upload; the worker downloads it first.
    sourceType: v.optional(v.union(v.literal("upload"), v.literal("url"))),
    sourceUrl: v.optional(v.string()),
    rightsConfirmedAt: v.optional(v.number()), // user confirmed they own / may use the video
    findMore: v.optional(v.boolean()), // queued only to find extra clips (transcript reused)
    // Link lookup (before download): shown to the user to approve.
    thumbnailUrl: v.optional(v.string()),
    channelName: v.optional(v.string()),
    estimateMb: v.optional(v.number()),
    estimateUsd: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    status: v.union(
      v.literal("uploading"),
      v.literal("checking"), // link: looking up length/size before any download
      v.literal("confirm"), // link: waiting for the user to approve the download cost
      v.literal("queued"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("failed")
    ),
    step: v.optional(
      v.union(
        v.literal("downloading"),
        v.literal("extracting"),
        v.literal("transcribing"),
        v.literal("finding")
      )
    ),
    progress: v.number(), // 0..100 within the whole pipeline
    error: v.optional(v.union(v.string(), v.null())),
    expiresAt: v.number(), // source video deleted after this (30 days)
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_status", ["status"])
    .index("by_expires", ["expiresAt"]),

  // Word-level transcript, stored in chunks (one per ~20 min of audio) to stay
  // under the 1 MB document limit.
  clipTranscripts: defineTable({
    sourceId: v.id("clipSources"),
    chunk: v.number(),
    words: v.array(v.object({ w: v.string(), s: v.number(), e: v.number() })),
  }).index("by_source", ["sourceId", "chunk"]),

  // AI-suggested clips for a source (seconds into the source video).
  clips: defineTable({
    sourceId: v.id("clipSources"),
    userId: v.string(),
    start: v.number(),
    end: v.number(),
    title: v.string(),
    hook: v.string(),
    reason: v.string(),
    score: v.number(), // 0..100
    text: v.string(), // transcript of the clip
    // ── User rating (feeds the clip finder's preferences) ──
    rating: v.optional(v.union(v.literal(1), v.literal(-1))),
    ratingReasons: v.optional(v.array(v.string())),
    ratedAt: v.optional(v.number()),
    // ── Editor settings (Phase 2) ──
    aspect: v.optional(v.union(v.literal("9:16"), v.literal("1:1"), v.literal("16:9"))),
    captionStyle: v.optional(
      v.union(v.literal("bold"), v.literal("karaoke"), v.literal("clean"), v.literal("none"))
    ),
    captionPosition: v.optional(v.union(v.literal("top"), v.literal("middle"), v.literal("bottom"))),
    cropX: v.optional(v.number()), // 0..1
    // User-edited caption words (absolute seconds), replacing transcript words
    // between captionRange.s and captionRange.e.
    captionWords: v.optional(v.array(v.object({ w: v.string(), s: v.number(), e: v.number() }))),
    captionRange: v.optional(v.object({ s: v.number(), e: v.number() })),
    // ── Export (rendered MP4 in R2) ──
    renderStatus: v.optional(
      v.union(v.literal("queued"), v.literal("rendering"), v.literal("done"), v.literal("failed"))
    ),
    renderProgress: v.optional(v.number()),
    renderError: v.optional(v.union(v.string(), v.null())),
    outputKey: v.optional(v.string()),
    renderQueuedAt: v.optional(v.number()),
    renderStartedAt: v.optional(v.number()),
    renderFinishedAt: v.optional(v.number()),
    // ── Smart edits (Phase 3): SmartEdit object, see types/clip.ts ──
    smart: v.optional(v.any()),
    smartStatus: v.optional(
      v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("failed"))
    ),
    smartError: v.optional(v.union(v.string(), v.null())),
    smartQueuedAt: v.optional(v.number()),
    smartStartedAt: v.optional(v.number()),
  })
    .index("by_source", ["sourceId", "start"])
    .index("by_render_status", ["renderStatus", "renderQueuedAt"])
    .index("by_user_rated", ["userId", "ratedAt"])
    .index("by_smart_status", ["smartStatus", "smartQueuedAt"]),

  // One row per AI call, for the admin cost dashboard.
  aiUsage: defineTable({
    userId: v.string(), // Clerk subject, or "anonymous"
    provider: v.union(v.literal("openai"), v.literal("gemini"), v.literal("apify"), v.literal("higgsfield"), v.literal("groq")),
    model: v.string(),
    feature: v.string(), // e.g. "analyzeTranscript"
    inputTokens: v.number(),
    outputTokens: v.number(),
    audioSeconds: v.optional(v.number()), // Whisper
    costUsd: v.number(),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_user_created", ["userId", "createdAt"]),

  // Server health heartbeats from the render worker (host /proc values).
  systemStats: defineTable({
    loadAvg1: v.number(),
    loadAvg5: v.number(),
    loadAvg15: v.number(),
    cpuCount: v.number(),
    memTotal: v.number(), // bytes
    memAvailable: v.number(),
    swapTotal: v.number(),
    swapFree: v.number(),
    diskTotal: v.number(),
    diskFree: v.number(),
    workerBusy: v.boolean(),
    currentRenderId: v.optional(v.id("renders")),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),
});
