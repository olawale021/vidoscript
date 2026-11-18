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
    moreCount: v.optional(v.number()), // extra clips requested via "Find more"
    stepDetail: v.optional(v.string()), // live detail for the current step, e.g. "Downloading 45% of 690 MB"
    // Which downloader to use: auto (main → backup → main again), or the
    // user's pick after a blocked attempt. "premium" = backup + residential proxy.
    downloader: v.optional(v.union(v.literal("auto"), v.literal("main"), v.literal("backup"), v.literal("premium"))),
    blocked: v.optional(v.boolean()), // the last attempt was blocked by YouTube
    replaceIds: v.optional(v.array(v.id("clips"))), // clips waiting for a replacement
    // Clip scout: moments viewers point to (timestamped comments, "most replayed").
    hints: v.optional(v.array(v.object({ start: v.number(), end: v.number(), label: v.string() }))),
    // Link lookup (before download): shown to the user to approve.
    thumbnailUrl: v.optional(v.string()),
    channelName: v.optional(v.string()),
    estimateMb: v.optional(v.number()),
    estimateUsd: v.optional(v.number()),
    availableQualities: v.optional(v.array(v.string())), // e.g. ["360","480","720","1080"]
    downloadQuality: v.optional(v.union(v.literal("360"), v.literal("480"), v.literal("720"), v.literal("1080"))),
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
    // ── Social post copy (caption + exactly 5 hashtags) ──
    postCaption: v.optional(v.string()),
    hashtags: v.optional(v.array(v.string())),
    // ── User rating (feeds the clip finder's preferences) ──
    rating: v.optional(v.union(v.literal(1), v.literal(-1))),
    ratingReasons: v.optional(v.array(v.string())),
    ratingNote: v.optional(v.string()), // the creator's own words (Replace)
    ratedAt: v.optional(v.number()),
    // ── Replace: the AI swaps a rejected clip for a different moment ──
    hidden: v.optional(v.boolean()), // replaced: kept only so the AI learns from it
    replacing: v.optional(v.boolean()), // replacement being found (card shows a placeholder)
    replacesClipId: v.optional(v.id("clips")),
    slotScore: v.optional(v.number()), // sort position inherited from the replaced clip
    // ── Editor settings (Phase 2) ──
    aspect: v.optional(v.union(v.literal("9:16"), v.literal("1:1"), v.literal("16:9"))),
    captionStyle: v.optional(
      v.union(v.literal("bold"), v.literal("karaoke"), v.literal("clean"), v.literal("none"))
    ),
    captionPosition: v.optional(v.union(v.literal("top"), v.literal("middle"), v.literal("bottom"))),
    cropX: v.optional(v.number()), // 0..1
    framing: v.optional(v.union(v.literal("fill"), v.literal("fit"))),
    fitBackground: v.optional(v.union(v.literal("black"), v.literal("blur"))),
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
    // Format the current MP4 was rendered with (to flag stale exports).
    renderedAspect: v.optional(v.string()),
    renderedFraming: v.optional(v.string()),
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

  // Failures from the worker, Convex actions and the app, for Admin → Errors.
  errorLogs: defineTable({
    source: v.union(v.literal("worker"), v.literal("convex"), v.literal("app")),
    feature: v.string(), // e.g. "clips.smartEdit"
    message: v.string(),
    kind: v.optional(v.string()), // "quota" | "rate_limit" | "auth" | "timeout" | "other"
    userId: v.optional(v.string()),
    clipId: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    resolved: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_created", ["createdAt"]),

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

  // ── Story Studio (types/story.ts) ──
  stories: defineTable({
    userId: v.string(),
    title: v.string(),
    idea: v.string(),
    aspect: v.union(v.literal("9:16"), v.literal("16:9")),
    targetSec: v.number(),
    style: v.string(),
    styleNotes: v.optional(v.string()),
    narratorVoice: v.string(),
    step: v.union(v.literal("script"), v.literal("plan"), v.literal("cast"), v.literal("board"), v.literal("export")),
    script: v.optional(v.string()),
    textAi: v.optional(v.union(v.literal("openai"), v.literal("gemini"))), // unset = the user's default
    // Earlier script versions for Undo (newest last, max 10).
    scriptHistory: v.optional(
      v.array(v.object({ script: v.string(), title: v.string(), hook: v.optional(v.string()), label: v.string(), at: v.number() }))
    ),
    hook: v.optional(v.string()),
    bible: v.optional(v.any()), // StoryBible
    captionStyle: v.optional(v.string()),
    videoModel: v.optional(v.string()), // Phase 2 default for "Animate"
    musicTrack: v.optional(v.union(v.string(), v.null())), // STORY_MUSIC id, null = none
    musicVolume: v.optional(v.number()),
    seriesId: v.optional(v.id("series")),
    outputKey: v.optional(v.string()),
    renderStatus: v.optional(v.union(v.literal("queued"), v.literal("rendering"), v.literal("done"), v.literal("failed"))),
    renderProgress: v.optional(v.number()),
    renderError: v.optional(v.union(v.string(), v.null())),
    costUsd: v.number(),
    error: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId", "createdAt"]),

  storyShots: defineTable({
    storyId: v.id("stories"),
    userId: v.string(),
    order: v.number(),
    narration: v.string(),
    speaker: v.string(), // "narrator" or a character id
    characters: v.array(v.string()),
    location: v.optional(v.union(v.string(), v.null())),
    camera: v.string(),
    imagePrompt: v.string(),
    motionPrompt: v.optional(v.string()), // Phase 2 (AI video)
    mode: v.optional(v.string()), // "still" | "video"
    // Phase 2: AI video clip made from the still (Higgsfield image-to-video).
    videoModel: v.optional(v.string()),
    videoKey: v.optional(v.union(v.string(), v.null())),
    videoStatus: v.optional(v.string()),
    videoError: v.optional(v.union(v.string(), v.null())),
    videoSec: v.optional(v.number()),
    videoCostUsd: v.optional(v.number()),
    stillKey: v.optional(v.union(v.string(), v.null())),
    stillStatus: v.string(),
    stillError: v.optional(v.union(v.string(), v.null())),
    continuity: v.optional(v.union(v.object({ ok: v.boolean(), issue: v.optional(v.string()) }), v.null())),
    audioKey: v.optional(v.union(v.string(), v.null())),
    audioSec: v.optional(v.number()),
    words: v.optional(v.array(v.object({ w: v.string(), s: v.number(), e: v.number() }))),
    audioStatus: v.string(),
    audioError: v.optional(v.union(v.string(), v.null())),
  }).index("by_story", ["storyId", "order"]),

  // ── Clip scout: YouTube videos worth clipping ──
  scoutTargets: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("keyword"), v.literal("channel")),
    query: v.string(), // keyword, or what the user pasted for a channel
    channelId: v.optional(v.string()),
    channelTitle: v.optional(v.string()),
    uploadsPlaylistId: v.optional(v.string()),
    clipFriendly: v.boolean(),
    everyHours: v.number(),
    enabled: v.boolean(),
    lastScannedAt: v.optional(v.number()),
    lastError: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_due", ["enabled", "lastScannedAt"]),

  scoutVideos: defineTable({
    userId: v.string(),
    videoId: v.string(),
    title: v.string(),
    channelId: v.string(),
    channelTitle: v.string(),
    thumbnail: v.optional(v.string()),
    publishedAt: v.number(),
    durationSec: v.number(),
    views: v.number(),
    likes: v.number(),
    comments: v.number(),
    channelMedianViews: v.optional(v.number()),
    score: v.number(),
    breakdown: v.any(), // { momentum, outperformance, engagement, moments, format, freshness, competition }
    moments: v.array(
      v.object({ t: v.number(), label: v.string(), mentions: v.number(), source: v.string() })
    ),
    aiNote: v.optional(v.string()),
    analyzedAt: v.optional(v.number()),
    aiTries: v.optional(v.number()), // AI note attempts; stops after 2 failures
    heatmapAt: v.optional(v.number()),
    competition: v.optional(v.object({ shorts: v.number(), topViews: v.number(), checkedAt: v.number() })),
    clipFriendly: v.boolean(),
    status: v.union(v.literal("new"), v.literal("saved"), v.literal("dismissed"), v.literal("clipped")),
    clipSourceId: v.optional(v.id("clipSources")),
    targetIds: v.array(v.id("scoutTargets")),
    busy: v.optional(v.union(v.string(), v.null())), // "heatmap" | "competition" while running
    // The user's taste: 👍/👎 + reasons/note (fed back into scoring and the AI).
    rating: v.optional(v.number()), // 1 | -1 (unset = not rated)
    ratingReasons: v.optional(v.array(v.string())),
    ratingNote: v.optional(v.string()),
    ratedAt: v.optional(v.number()),
    // AI's 0–100 guess of how well this matches the user's taste, and why.
    fit: v.optional(v.number()),
    fitWhy: v.optional(v.string()),
    firstSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_score", ["userId", "score"])
    .index("by_user_video", ["userId", "videoId"])
    .index("by_user_channel", ["userId", "channelId"])
    .index("by_user_rated", ["userId", "ratedAt"]),

  // Channel baseline (median views of recent uploads), refreshed daily.
  scoutChannels: defineTable({
    channelId: v.string(),
    title: v.string(),
    uploadsPlaylistId: v.string(),
    medianViews: v.union(v.number(), v.null()),
    country: v.optional(v.string()), // YouTube channel country (ISO 2), when the owner set it
    updatedAt: v.number(),
  }).index("by_channel", ["channelId"]),

  // YouTube Data API units used per UTC day (one key shared by the whole app).
  scoutQuota: defineTable({ day: v.string(), units: v.number() }).index("by_day", ["day"]),

  // Phase 3: a reusable cast + style; each story can be an episode of one.
  series: defineTable({
    userId: v.string(),
    title: v.string(),
    style: v.string(),
    styleNotes: v.optional(v.string()),
    aspect: v.union(v.literal("9:16"), v.literal("16:9")),
    narratorVoice: v.string(),
    bible: v.any(), // StoryBible with refKeys under stories/<user>/series/<id>/refs/
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId", "updatedAt"]),

  // What the creator liked / disliked at each step (explicit taps + implicit
  // signals like redraws). Fed back into the AI prompts (convex/storyWorker.ts).
  storyFeedback: defineTable({
    userId: v.string(),
    storyId: v.id("stories"),
    stage: v.union(v.literal("script"), v.literal("plan"), v.literal("still"), v.literal("motion"), v.literal("voice"), v.literal("video")),
    targetId: v.optional(v.string()), // shot id for still / voice
    rating: v.number(), // 1, -1, or 0 (a note only)
    reasons: v.array(v.string()),
    note: v.optional(v.string()),
    snapshot: v.optional(v.string()), // what was rated
    implicit: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user_stage", ["userId", "stage", "createdAt"])
    .index("by_target", ["storyId", "stage", "targetId"]),

  // Per-user defaults for new stories, clips and downloads (Settings page).
  userSettings: defineTable({
    userId: v.string(),
    defaultNarratorVoice: v.optional(v.string()),
    defaultStoryAspect: v.optional(v.union(v.literal("9:16"), v.literal("16:9"))),
    defaultStoryLength: v.optional(v.number()),
    defaultClipAspect: v.optional(v.union(v.literal("9:16"), v.literal("1:1"), v.literal("16:9"))),
    defaultFraming: v.optional(v.union(v.literal("fill"), v.literal("fit"))),
    defaultFitBackground: v.optional(v.union(v.literal("black"), v.literal("blur"))),
    defaultCaptionStyle: v.optional(
      v.union(v.literal("bold"), v.literal("karaoke"), v.literal("clean"), v.literal("none"))
    ),
    defaultDownloadQuality: v.optional(v.union(v.literal("360"), v.literal("480"), v.literal("720"), v.literal("1080"))),
    niches: v.optional(v.array(v.string())), // clip niches (preset labels or the user's own), used by Discover + its AI
    discoverWindowDays: v.optional(v.number()), // keyword scans look this far back: 7 | 30 | 90 | 365
    discoverLanguage: v.optional(v.union(v.literal("en"), v.literal("any"))),
    defaultTextAi: v.optional(v.union(v.literal("openai"), v.literal("gemini"))),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // ── Social posting & tracking (direct platform APIs) ──

  // A connected account (one per platform account). Tokens are AES-GCM
  // encrypted (SOCIAL_TOKEN_KEY) and only decrypted inside socialNode.ts.
  socialAccounts: defineTable({
    userId: v.string(),
    platform: v.union(v.literal("instagram"), v.literal("youtube"), v.literal("tiktok")),
    externalId: v.string(), // platform account id
    handle: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
    // Instagram: "facebook" = Unified login (Facebook Login for Business, graph.facebook.com);
    // unset = Instagram login (graph.instagram.com, older apps).
    via: v.optional(v.string()),
    // Profile numbers from the last sync (Socials page).
    profile: v.optional(
      v.object({
        followers: v.optional(v.number()),
        following: v.optional(v.number()),
        videoCount: v.optional(v.number()),
        totalViews: v.optional(v.number()),
        totalLikes: v.optional(v.number()),
      })
    ),
    syncedAt: v.optional(v.number()),
    syncError: v.optional(v.union(v.string(), v.null())),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("revoked")),
    lastError: v.optional(v.union(v.string(), v.null())),
    connectedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "platform"])
    .index("by_external", ["platform", "externalId"])
    .index("by_expiry", ["status", "tokenExpiresAt"]),

  // OAuth "state" for a connect in progress (10 min).
  socialConnects: defineTable({
    state: v.string(),
    userId: v.string(),
    platform: v.string(),
    returnTo: v.string(), // app origin to send the browser back to
    codeVerifier: v.optional(v.string()), // PKCE (TikTok)
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // One post of one video to one account.
  socialPosts: defineTable({
    userId: v.string(),
    accountId: v.id("socialAccounts"),
    platform: v.string(),
    sourceType: v.union(v.literal("story"), v.literal("clip")),
    sourceId: v.string(),
    title: v.string(), // video title (YouTube) / label in the app
    caption: v.string(),
    privacy: v.optional(v.string()), // platform-specific (e.g. youtube public/unlisted/private)
    aiLabel: v.optional(v.boolean()), // disclose AI-generated / synthetic content where supported
    // TikTok post settings (chosen in the Post dialog, per TikTok's posting rules).
    tiktok: v.optional(
      v.object({
        disableComment: v.boolean(),
        disableDuet: v.boolean(),
        disableStitch: v.boolean(),
        brandOrganic: v.boolean(), // promoting your own business
        brandContent: v.boolean(), // paid partnership / branded content
      })
    ),
    scheduledAt: v.optional(v.number()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("queued"),
      v.literal("posting"),
      v.literal("published"),
      v.literal("failed")
    ),
    step: v.optional(v.string()), // live progress text
    containerId: v.optional(v.string()), // platform upload/container id while processing
    platformPostId: v.optional(v.string()),
    url: v.optional(v.string()),
    error: v.optional(v.union(v.string(), v.null())),
    publishedAt: v.optional(v.number()),
    // Latest stats (history in socialStats).
    stats: v.optional(
      v.object({
        views: v.optional(v.number()),
        likes: v.optional(v.number()),
        comments: v.optional(v.number()),
        shares: v.optional(v.number()),
        saves: v.optional(v.number()),
        reach: v.optional(v.number()),
        avgWatchSec: v.optional(v.number()),
      })
    ),
    statsAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status", "scheduledAt"])
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_stats", ["status", "statsAt"]),

  // Recent videos on each connected account (all of them, not only ones
  // posted from VidoScript), refreshed by socialNode.syncAccount.
  socialMedia: defineTable({
    accountId: v.id("socialAccounts"),
    userId: v.string(),
    platform: v.string(),
    externalId: v.string(),
    title: v.string(),
    thumbnailUrl: v.optional(v.string()),
    url: v.optional(v.string()),
    publishedAt: v.number(),
    durationSec: v.optional(v.number()),
    kind: v.optional(v.string()), // reel / short / video / image / carousel
    views: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId", "publishedAt"])
    .index("by_external", ["accountId", "externalId"]),

  // Stats snapshots over time (for charts and the learning loop).
  socialStats: defineTable({
    postId: v.id("socialPosts"),
    at: v.number(),
    views: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    saves: v.optional(v.number()),
    reach: v.optional(v.number()),
    avgWatchSec: v.optional(v.number()),
  }).index("by_post", ["postId", "at"]),

  // One queue for every story step; the worker claims jobs by kind.
  storyJobs: defineTable({
    storyId: v.id("stories"),
    userId: v.string(),
    kind: v.union(v.literal("script"), v.literal("line"), v.literal("piece"), v.literal("plan"), v.literal("ref"), v.literal("still"), v.literal("voice"), v.literal("video"), v.literal("render")),
    targetId: v.optional(v.string()), // shot id, or "character:<id>" / "location:<id>"
    input: v.optional(v.string()), // e.g. rewrite notes
    status: v.union(v.literal("queued"), v.literal("working"), v.literal("done"), v.literal("failed")),
    attempts: v.number(),
    startedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_story", ["storyId", "status"]),
});
