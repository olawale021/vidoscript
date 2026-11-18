// Clip scout scoring and comment-moment extraction (pure functions, shared by
// convex/scoutNode.ts and tests). Scores are 0–100 with a visible breakdown.

export type ScoutMoment = { t: number; label: string; mentions: number; source: string };

export type ScoreInput = {
  publishedAt: number;
  durationSec: number;
  views: number;
  likes: number;
  comments: number;
  channelMedianViews?: number | null;
  title: string;
  description?: string;
  moments: ScoutMoment[];
  competitionShorts?: number | null;
  now?: number;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const logScale = (x: number, full: number) => (x <= 0 ? 0 : clamp01(Math.log10(1 + x) / Math.log10(1 + full)));

// YouTube ISO 8601 duration, e.g. "PT1H23M45S" → 5025.
export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 86400) + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

const TALK = /podcast|interview|episode|ep\.?\s?\d|stream|live|conversation|q&a|reacts?|debate|show|talk|story|full/i;

export function scoreVideo(v: ScoreInput) {
  const now = v.now ?? Date.now();
  const hours = Math.max(1, (now - v.publishedAt) / 3_600_000);
  const viewsPerHour = v.views / hours;
  const momentum = 25 * logScale(viewsPerHour, 5000);

  // Reach: total views, so already-viral videos rank too (10K = 0, 100K ≈ 5, 1M ≈ 11, 5M+ = 15).
  const reach = 15 * clamp01((Math.log10(Math.max(1, v.views)) - 4) / (Math.log10(5_000_000) - 4));

  const ratio = v.channelMedianViews && v.channelMedianViews > 0 ? v.views / v.channelMedianViews : null;
  // 1× = average for the channel (0), 3× strong, 10× full marks.
  const outperformance = ratio === null ? 8 : 20 * clamp01(Math.log10(Math.max(1, ratio)) / Math.log10(10));

  const engagementRate = v.views > 0 ? (v.likes + 3 * v.comments) / v.views : 0;
  const engagement = 12 * clamp01(engagementRate / 0.06); // ~6% is very engaged for long-form

  const mentionTotal = v.moments.filter((m) => m.source === "comments").reduce((s, m) => s + m.mentions, 0);
  const moments = 13 * clamp01(mentionTotal / 12);

  const minutes = v.durationSec / 60;
  const lengthFit = minutes < 8 ? 0 : minutes < 20 ? 0.5 : minutes <= 180 ? 1 : 0.6;
  const format = 10 * clamp01(lengthFit * (TALK.test(`${v.title} ${v.description ?? ""}`) ? 1 : 0.7));

  const freshness = hours <= 72 ? 5 : hours <= 168 ? 2.5 : 0;

  // Many existing Shorts clips of the same video = crowded.
  const competition = v.competitionShorts == null ? 0 : -20 * clamp01(v.competitionShorts / 25);

  const breakdown = {
    momentum: Math.round(momentum),
    reach: Math.round(reach),
    outperformance: Math.round(outperformance),
    engagement: Math.round(engagement),
    moments: Math.round(moments),
    format: Math.round(format),
    freshness: Math.round(freshness),
    competition: Math.round(competition),
    viewsPerHour: Math.round(viewsPerHour),
    outperformanceRatio: ratio === null ? null : Math.round(ratio * 10) / 10,
  };
  const score = Math.max(
    0,
    Math.min(100, Math.round(momentum + reach + outperformance + engagement + moments + format + freshness + competition))
  );
  return { score, breakdown };
}

// "12:45", "1:02:03" → seconds.
function toSeconds(ts: string) {
  const parts = ts.split(":").map(Number);
  return parts.reduce((s, n) => s * 60 + n, 0);
}

// Timestamped comments → moments: cluster mentions within ±20 s, weight by likes,
// label with the most-liked comment's text (timestamp stripped).
export function commentMoments(
  comments: { text: string; likes: number }[],
  durationSec: number,
  max = 5
): ScoutMoment[] {
  const hits: { t: number; weight: number; text: string; likes: number }[] = [];
  // Navigation comments ("0:15 ad skip", "sponsor ends 2:10") aren't moments.
  const NAV = /\b(skip|skips|sponsor|sponsored|ads?|advert|intro|outro|starts? at|chapters?|timestamps?)\b/i;
  for (const c of comments) {
    if (NAV.test(c.text)) continue;
    const found = c.text.match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g) ?? [];
    const uniq = [...new Set(found)].slice(0, 3);
    for (const ts of uniq) {
      const t = toSeconds(ts);
      if (t <= 0 || (durationSec && t > durationSec)) continue;
      hits.push({ t, weight: 1 + Math.log10(1 + c.likes), text: c.text, likes: c.likes });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  const clusters: { t: number; weight: number; mentions: number; best: { text: string; likes: number } }[] = [];
  for (const h of hits) {
    const last = clusters[clusters.length - 1];
    if (last && h.t - last.t <= 20) {
      last.weight += h.weight;
      last.mentions += 1;
      if (h.likes > last.best.likes) last.best = h;
    } else {
      clusters.push({ t: h.t, weight: h.weight, mentions: 1, best: h });
    }
  }
  return clusters
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .map((c) => ({
      t: c.t,
      mentions: c.mentions,
      source: "comments",
      label: c.best.text.replace(/<[^>]+>/g, "").replace(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "Viewers point here",
    }));
}

export const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const QUOTA_SCAN_LIMIT = 9000; // leave room for on-demand checks

// ── The user's taste ──
// 👍/👎 reasons shown on Discover cards (also used in the AI's taste profile).
export const SCOUT_REASONS = {
  up: ["Great topic", "Love this channel", "Strong moments", "Funny", "Insightful", "Drama / debate", "Good length"],
  down: ["Wrong topic", "Not my niche", "Boring / slow", "Don't like this channel", "Too long", "Already clipped a lot", "Low quality", "Not English"],
};

const clampN = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// Channel signal from the user's past reactions to that channel's videos:
// 👍 or clipped = +1, 👎 = −1, dismissed without a rating = −0.5. ±8 points.
export function channelTastePoints(rows: { rating?: number; status: string }[]) {
  let net = 0;
  for (const r of rows) {
    if (r.rating === 1) net += 1;
    else if (r.rating === -1) net -= 1;
    else if (r.status === "clipped") net += 1;
    else if (r.status === "dismissed") net -= 0.5;
  }
  return Math.round(8 * clampN(net / 3, -1, 1));
}

// AI taste fit (0–100, 50 = neutral) → ±10 points; total taste is capped at ±15.
export function tastePoints(channelPts: number, fit?: number | null) {
  const fitPts = fit == null ? 0 : Math.round((clampN(fit, 0, 100) - 50) / 5);
  return clampN(channelPts + fitPts, -15, 15);
}

export function withTaste(base: { score: number; breakdown: Record<string, unknown> }, taste: number) {
  return {
    score: clampN(Math.round(base.score + taste), 0, 100),
    breakdown: { ...base.breakdown, taste },
  };
}

// Ready-made niches for Discover: tap a niche, then tap keywords to watch.
// Keywords lean toward long talk formats (podcasts, interviews, streams).
export const SCOUT_NICHES: { id: string; label: string; emoji: string; keywords: string[] }[] = [
  { id: "business", label: "Business & startups", emoji: "💼", keywords: ["startup founder podcast", "entrepreneur interview", "business podcast full episode", "shark tank pitch", "ceo interview"] },
  { id: "money", label: "Money & investing", emoji: "💰", keywords: ["personal finance podcast", "investing interview", "real estate podcast", "crypto podcast", "millionaire interview"] },
  { id: "combat", label: "Boxing & MMA", emoji: "🥊", keywords: ["boxing interview", "ufc press conference", "mma podcast", "fight week interview", "boxing face off press conference"] },
  { id: "football", label: "Football (soccer)", emoji: "⚽", keywords: ["football podcast", "premier league press conference", "footballer interview", "football debate show"] },
  { id: "basketball", label: "Basketball", emoji: "🏀", keywords: ["nba podcast", "nba player interview", "basketball debate show", "nba press conference"] },
  { id: "nfl", label: "American football", emoji: "🏈", keywords: ["nfl podcast", "nfl player interview", "nfl debate show"] },
  { id: "streamers", label: "Streamers & gaming", emoji: "🎮", keywords: ["streamer full stream", "irl stream highlights full", "gaming podcast", "twitch stream full vod"] },
  { id: "comedy", label: "Comedy & funny podcasts", emoji: "😂", keywords: ["comedy podcast full episode", "comedian interview", "stand up comedy special", "funny podcast"] },
  { id: "celebs", label: "Celebrity interviews", emoji: "🎤", keywords: ["celebrity interview full", "hot ones", "late night interview full", "actor interview podcast"] },
  { id: "music", label: "Hip-hop & music", emoji: "🎧", keywords: ["rapper interview", "hip hop podcast", "music producer interview", "artist interview full"] },
  { id: "dating", label: "Dating & relationships", emoji: "❤️", keywords: ["dating podcast", "relationship advice podcast", "men women debate podcast", "marriage podcast"] },
  { id: "self", label: "Self-improvement", emoji: "🧠", keywords: ["motivation podcast", "self improvement podcast", "discipline interview", "mindset podcast"] },
  { id: "health", label: "Health & fitness", emoji: "💪", keywords: ["fitness podcast", "health doctor podcast", "nutrition podcast", "bodybuilder interview"] },
  { id: "tech", label: "Tech & AI", emoji: "🤖", keywords: ["ai podcast", "tech founder interview", "tech podcast full episode", "silicon valley interview"] },
  { id: "debate", label: "Politics & debate", emoji: "🗣️", keywords: ["debate full", "political podcast", "street interview debate", "panel debate show"] },
  { id: "crime", label: "True crime & stories", emoji: "🕵️", keywords: ["true crime podcast", "prison story interview", "storytime podcast", "former gang member interview"] },
  { id: "science", label: "Science & history", emoji: "🔭", keywords: ["science podcast", "history podcast", "space podcast", "scientist interview"] },
  { id: "faith", label: "Faith & spirituality", emoji: "🙏", keywords: ["christian podcast", "sermon full", "spirituality podcast", "pastor interview"] },
];

// ── Language (Discover "English only") ──

// Channels based where English is the main language on YouTube. Channels with
// no country set are kept; the title check below still applies.
export const ENGLISH_COUNTRIES = new Set([
  "US", "GB", "CA", "AU", "NZ", "IE", "ZA", "NG", "GH", "KE", "UG", "JM", "TT", "BS", "BB", "SG", "MT", "BZ", "GY", "ZW", "ZM", "BW",
]);

// Scripts that aren't Latin (Indian scripts, Arabic, Cyrillic, CJK, Thai, Hebrew, Greek…).
const NON_LATIN = /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g;

// Very common words in other Latin-script languages (none are common English words).
const FOREIGN_WORDS = new Set(
  (
    "el los las del una por para con que como pero más muy está esto sobre cómo qué hace desde hasta " + // es
    "les des une est pour avec dans sur pas qui sont mais très cette ces vous nous leur aussi comment du au aux le la et je à " + // fr
    "não uma com para mais você isso como pelo pela sobre quando muito também então " + // pt
    "der die das und ist nicht mit sich auf für ein eine dem den wie auch noch nach wird " + // de
    "il della delle dei gli sono questo questa perché anche molto come " + // it
    "het een van en niet zijn voor met ook maar wat " + // nl
    "és az egy hogy nem meg ami van már csak nap alatt rész " + // hu
    "yang dan ini itu dengan untuk dari tidak ada akan " + // id/ms
    "ang mga ng sa hindi ako siya kami " + // tl
    "och att det som för inte med " + // sv
    "się nie jest na że do jak ale"
  ).split(" ")
);
const ENGLISH_WORDS = new Set(
  "the and you to of is in it that for on with this how why what my your we they he she was are be at from about who will can not".split(" ")
);

// true when the text looks like it's in a language other than English.
export function looksNonEnglish(text: string) {
  const nonLatin = (text.match(NON_LATIN) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters > 0 && nonLatin / letters > 0.2) return true;
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let foreign = 0;
  let english = 0;
  for (const w of words) {
    if (FOREIGN_WORDS.has(w)) foreign++;
    else if (ENGLISH_WORDS.has(w)) english++;
  }
  return foreign >= 2 && foreign > english;
}
