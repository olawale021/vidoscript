"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Bookmark,
  Check,
  ExternalLink,
  Flame,
  Loader2,
  Plus,
  Radar,
  Scissors,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Bar, Chip, Panel, PanelBody, Ring, Segmented, Tone } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { ClipsTabs } from "../_components/clips-tabs";
import { SCOUT_NICHES, SCOUT_REASONS } from "@/convex/scoutLib";

// Clips → Discover (the clip scout): YouTube videos worth clipping, ranked by clip score.

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const fmtLen = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const fmtT = (s: number) => fmtLen(Math.max(0, Math.round(s)));
const ago = (t: number) => {
  const h = (Date.now() - t) / 3_600_000;
  return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

const BREAKDOWN: { key: string; label: string; max: number }[] = [
  { key: "momentum", label: "Momentum", max: 25 },
  { key: "reach", label: "Reach", max: 15 },
  { key: "outperformance", label: "Beats channel avg", max: 20 },
  { key: "engagement", label: "Engagement", max: 12 },
  { key: "moments", label: "Comment moments", max: 13 },
  { key: "format", label: "Format", max: 10 },
  { key: "freshness", label: "Fresh", max: 5 },
];

const SOURCE_LABEL: Record<string, string> = { comments: "💬", heatmap: "🔥", ai: "✨" };

type Status = "new" | "saved" | "clipped" | "dismissed";

// 👍 / 👎 with reason chips and an optional note. Saved on every change; the
// scout re-ranks this channel now and uses it in future AI picks.
function Rating({ v }: { v: Doc<"scoutVideos"> }) {
  const rate = useMutation(api.scout.rate);
  const setStatus = useMutation(api.scout.setStatus);
  const rating = v.rating ?? 0;
  const reasons = v.ratingReasons ?? [];
  const [note, setNote] = useState(v.ratingNote ?? "");
  const [open, setOpen] = useState(false);
  const save = (next: { rating: number; reasons: string[]; note?: string }) =>
    rate({ id: v._id, rating: next.rating, reasons: next.reasons, note: (next.note ?? note) || undefined }).catch(() => {});
  const tap = (r: 1 | -1) => {
    const next = rating === r ? 0 : r;
    setOpen(next !== 0);
    if (next === 0) setNote("");
    save({ rating: next, reasons: next === rating ? reasons : [], note: next === 0 ? "" : note });
  };
  const toggle = (x: string) => save({ rating, reasons: reasons.includes(x) ? reasons.filter((y) => y !== x) : [...reasons, x] });
  const options = rating > 0 ? SCOUT_REASONS.up : rating < 0 ? SCOUT_REASONS.down : [];
  const btn = (on: boolean, tone: "up" | "down") =>
    cn(
      "flex h-8 w-8 items-center justify-center rounded-md transition",
      on ? (tone === "up" ? "bg-ok/12 text-ok" : "bg-bad/14 text-bad") : "text-faint hover:bg-surface-3 hover:text-fg"
    );

  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <span className="mr-1 text-xs text-muted">Your taste</span>
        <button aria-label="I like this" aria-pressed={rating > 0} onClick={() => tap(1)} className={btn(rating > 0, "up")}>
          <ThumbsUp size={14} />
        </button>
        <button aria-label="Not for me" aria-pressed={rating < 0} onClick={() => tap(-1)} className={btn(rating < 0, "down")}>
          <ThumbsDown size={14} />
        </button>
        {rating !== 0 && !open && (
          <button onClick={() => setOpen(true)} className="min-h-8 truncate px-1 text-left text-[11px] text-faint hover:text-fg">
            {reasons.length ? reasons.join(", ") : "Why?"}
          </button>
        )}
      </div>
      {open && rating !== 0 && (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-1">
            {options.map((x) => (
              <button
                key={x}
                onClick={() => toggle(x)}
                className={cn(
                  "min-h-8 rounded-full border px-2.5 py-1 text-xs transition",
                  reasons.includes(x) ? "border-fg bg-surface-3 text-fg" : "border-line-strong text-muted hover:text-fg"
                )}
              >
                {x}
              </button>
            ))}
          </div>
          <input
            aria-label="Note for the scout"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (v.ratingNote ?? "") && save({ rating, reasons, note })}
            placeholder={rating > 0 ? "What do you like about it? (optional)" : "What's off about it? (optional)"}
            className="w-full rounded-[10px] border border-line bg-bg px-3 py-1.5 text-base text-fg placeholder:text-faint focus:border-line-strong focus:outline-none sm:text-sm"
          />
          <div className="flex items-center gap-2">
            <button onClick={() => setOpen(false)} className="min-h-8 px-1 text-[11px] text-faint hover:text-fg">
              Done
            </button>
            {rating < 0 && v.status !== "dismissed" && v.status !== "clipped" && (
              <button
                onClick={() => setStatus({ id: v._id, status: "dismissed" })}
                className="min-h-8 px-1 text-[11px] text-faint hover:text-bad"
              >
                Also dismiss it
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// AI-suggested niche keywords from what the user liked; one tap adds one.
function KeywordIdeas() {
  const suggest = useAction(api.scoutNode.suggestKeywords);
  const addKeyword = useMutation(api.scout.addKeyword);
  const [ideas, setIdeas] = useState<{ keyword: string; why: string }[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setIdeas(await suggest({}));
            } catch (e) {
              setError(errText(e));
            } finally {
              setBusy(false);
            }
          }}
          title="Uses your 👍/👎 to find keywords for your niche (about a tenth of a cent)"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Suggest niche keywords
        </Button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      {ideas && ideas.length === 0 && <p className="text-xs text-faint">No new ideas right now. Rate a few more videos and try again.</p>}
      {ideas && ideas.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {ideas.map((x) => {
            const done = added.includes(x.keyword);
            return (
              <li key={x.keyword}>
                <button
                  disabled={done}
                  onClick={async () => {
                    try {
                      await addKeyword({ query: x.keyword });
                      setAdded((a) => [...a, x.keyword]);
                    } catch (e) {
                      setError(errText(e));
                    }
                  }}
                  title={x.why}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                    done ? "border-ok/40 text-ok" : "border-dashed border-line-strong text-muted hover:text-fg"
                  )}
                >
                  {done ? <Check size={11} /> : <Plus size={11} />} {x.keyword}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Niche = { id: string; label: string; emoji: string; keywords: string[] | null };

// Niches: the user's own (from Settings) first, then the ready-made ones.
// Ready-made niches come with keywords; for the user's own, the AI suggests some.
function NicheIdeas({ watching }: { watching: string[] }) {
  const settings = useQuery(api.settings.get);
  const addKeyword = useMutation(api.scout.addKeyword);
  const suggest = useAction(api.scoutNode.suggestKeywords);
  const [niche, setNiche] = useState<string | null>(null);
  const [aiIdeas, setAiIdeas] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const have = new Set(watching.map((k) => k.toLowerCase().trim()));

  const mine = settings?.niches ?? [];
  const mineSet = new Set(mine.map((n) => n.toLowerCase()));
  const presets: Niche[] = SCOUT_NICHES.map((n) => ({ ...n }));
  const own: Niche[] = mine
    .filter((n) => !presets.some((p) => p.label.toLowerCase() === n.toLowerCase()))
    .map((n) => ({ id: `own:${n}`, label: n, emoji: "⭐", keywords: null }));
  const list = [
    ...own,
    ...presets.filter((p) => mineSet.has(p.label.toLowerCase())),
    ...presets.filter((p) => !mineSet.has(p.label.toLowerCase())),
  ];
  const picked = list.find((n) => n.id === niche);
  const keywords = picked ? [...(picked.keywords ?? []), ...(aiIdeas[picked.id] ?? [])] : [];

  const askAi = async (n: Niche) => {
    setBusy(true);
    setError(null);
    try {
      const r = await suggest({ niche: n.label });
      setAiIdeas((m) => ({ ...m, [n.id]: [...new Set([...(m[n.id] ?? []), ...r.map((x) => x.keyword)])] }));
      if (r.length === 0) setError("No new ideas for this niche right now.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">Pick a niche</span>
        <Link href="/dashboard/settings" className="min-h-8 px-1 text-[11px] text-faint hover:text-fg">
          {mine.length ? "Edit your niches" : "Set your niches in Settings"}
        </Link>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        {list.map((n) => {
          const isMine = mineSet.has(n.label.toLowerCase());
          return (
            <button
              key={n.id}
              onClick={() => {
                setError(null);
                const next = niche === n.id ? null : n.id;
                setNiche(next);
                if (next && !n.keywords && !aiIdeas[n.id]) askAi(n);
              }}
              aria-pressed={niche === n.id}
              className={cn(
                "inline-flex min-h-8 flex-shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                niche === n.id
                  ? "border-fg bg-surface-3 text-fg"
                  : isMine
                    ? "border-accent/50 text-fg hover:border-accent"
                    : "border-line-strong text-muted hover:text-fg"
              )}
              title={isMine ? "One of your niches" : undefined}
            >
              <span>{n.emoji}</span> {n.label}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="grid gap-1.5 rounded-[10px] border border-line bg-bg p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {picked.emoji} {picked.label}: tap to watch
            </span>
            {keywords.some((k) => !have.has(k.toLowerCase())) && (
              <button
                onClick={async () => {
                  setError(null);
                  for (const k of keywords.filter((k) => !have.has(k.toLowerCase()))) {
                    try {
                      await addKeyword({ query: k });
                    } catch (e) {
                      setError(errText(e));
                      break;
                    }
                  }
                }}
                className="min-h-8 px-1 text-[11px] text-faint hover:text-fg"
              >
                Add all
              </button>
            )}
          </div>
          {keywords.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {keywords.map((k) => {
                const done = have.has(k.toLowerCase());
                return (
                  <li key={k}>
                    <button
                      disabled={done}
                      onClick={() => addKeyword({ query: k }).catch((e) => setError(errText(e)))}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition",
                        done ? "border-ok/40 text-ok" : "border-dashed border-line-strong text-muted hover:text-fg"
                      )}
                    >
                      {done ? <Check size={11} /> : <Plus size={11} />} {k}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <button
              disabled={busy}
              onClick={() => askAi(picked)}
              className="inline-flex min-h-8 items-center gap-1 px-1 text-[11px] text-faint hover:text-fg disabled:opacity-50"
              title="About a tenth of a cent"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {busy ? "Thinking of keywords…" : "More keyword ideas with AI"}
            </button>
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
          <p className="text-[11px] text-faint">Each keyword uses about 400 of the app&apos;s 10,000 daily YouTube units (4 scans a day). Start with 3–5.</p>
        </div>
      )}
    </div>
  );
}

function Targets() {
  const targets = useQuery(api.scout.targets);
  const addKeyword = useMutation(api.scout.addKeyword);
  const addChannel = useAction(api.scoutNode.addChannel);
  const update = useMutation(api.scout.updateTarget);
  const remove = useMutation(api.scout.removeTarget);
  const [kind, setKind] = useState<"keyword" | "channel">("keyword");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (kind === "keyword") await addKeyword({ query: text });
      else await addChannel({ input: text });
      setText("");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelBody className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            label="What to watch"
            value={kind}
            onChange={(k) => setKind(k as "keyword" | "channel")}
            options={[
              { value: "keyword", label: "Keyword" },
              { value: "channel", label: "Channel" },
            ]}
          />
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-bg pl-3 pr-1.5 h-10 min-w-[220px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) submit();
            }}
          >
            {kind === "keyword" ? <Search size={15} className="text-faint" /> : <Users size={15} className="text-faint" />}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={kind === "keyword" ? "Keyword" : "Channel link or @handle"}
              placeholder={kind === "keyword" ? "e.g. startup podcast, boxing interview" : "Channel link or @handle"}
              className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint sm:text-sm"
            />
            <Button size="sm" type="submit" disabled={busy || !text.trim()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </Button>
          </form>
        </div>
        {error && <p className="text-xs text-bad">{error}</p>}
        {targets && targets.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {targets.map((t: Doc<"scoutTargets">) => (
              <li
                key={t._id}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  t.enabled ? "border-line-strong text-muted" : "border-line text-faint opacity-60"
                )}
                title={t.lastError ?? (t.lastScannedAt ? `Scanned ${ago(t.lastScannedAt)}` : "Not scanned yet")}
              >
                {t.kind === "keyword" ? <Search size={11} /> : <Users size={11} />}
                <span className="max-w-[180px] truncate text-fg">{t.kind === "channel" ? t.channelTitle ?? t.query : t.query}</span>
                {t.kind === "channel" && (
                  <button
                    onClick={() => update({ targetId: t._id, clipFriendly: !t.clipFriendly })}
                    className={cn("rounded-full px-1.5", t.clipFriendly ? "bg-ok/15 text-ok" : "text-faint hover:text-fg")}
                    title="Mark this channel as welcoming clippers"
                  >
                    {t.clipFriendly ? "✓ clip-friendly" : "clip-friendly?"}
                  </button>
                )}
                {t.lastError && <span className="text-bad">!</span>}
                <button aria-label={`Remove ${t.query}`} onClick={() => remove({ targetId: t._id })} className="text-faint hover:text-bad">
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-faint">
            Add topics you clip (keywords) and channels you follow. The scout checks them every 6 hours.
          </p>
        )}
        {targets && (
          <details className="group rounded-[10px] border border-line px-3 py-2" open={targets.length === 0}>
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-xs text-muted hover:text-fg">
              <Sparkles size={13} /> Need ideas? Niches and suggested keywords
            </summary>
            <div className="mt-2 grid gap-3">
              <NicheIdeas watching={targets.filter((t: Doc<"scoutTargets">) => t.kind === "keyword").map((t: Doc<"scoutTargets">) => t.query)} />
              <KeywordIdeas />
            </div>
          </details>
        )}
      </PanelBody>
    </Panel>
  );
}

function VideoCard({ v }: { v: Doc<"scoutVideos"> }) {
  const router = useRouter();
  const setStatus = useMutation(api.scout.setStatus);
  const clipThis = useMutation(api.scout.clipThis);
  const findMoments = useAction(api.scoutNode.findMoments);
  const checkCompetition = useAction(api.scoutNode.checkCompetition);
  const [rights, setRights] = useState(false);
  const [askRights, setAskRights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const b = (v.breakdown ?? {}) as Record<string, number | null>;
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const yt = (t?: number) => `https://www.youtube.com/watch?v=${v.videoId}${t ? `&t=${Math.round(t)}s` : ""}`;
  const moments = v.moments.slice().sort((a, x) => x.mentions - a.mentions).slice(0, 6);

  return (
    <li className="grid gap-3 rounded-[12px] border border-line bg-surface p-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:p-3.5">
      <a href={yt()} target="_blank" rel="noreferrer" className="relative block aspect-video overflow-hidden rounded-[10px] bg-surface-2">
        {v.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
        )}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 font-mono text-[11px] text-white">{fmtLen(v.durationSec)}</span>
      </a>
      <div className="grid min-w-0 gap-2">
        <div className="flex items-start gap-3">
          <Ring value={v.score} title="Clip score" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-snug break-words">{v.title}</h3>
            <p className="mt-0.5 text-xs text-faint">
              {v.channelTitle} · {ago(v.publishedAt)} · {fmtNum(v.views)} views
              {b.viewsPerHour ? ` · ${fmtNum(b.viewsPerHour)}/h` : ""}
              {b.outperformanceRatio ? ` · ${b.outperformanceRatio}× channel avg` : ""}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {v.clipFriendly && <Tone tone="ok">clip-friendly</Tone>}
              {v.status === "saved" && <Tone tone="muted">saved</Tone>}
              {v.competition && (
                <Tone tone={v.competition.shorts >= 10 ? "bad" : v.competition.shorts >= 3 ? "warn" : "ok"}>
                  {v.competition.shorts} clips already
                  {v.competition.topViews ? ` · top ${fmtNum(v.competition.topViews)}` : ""}
                </Tone>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {BREAKDOWN.map((x) => (
            <span key={x.key} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted" title={`${x.label}: ${b[x.key] ?? 0} of ${x.max}`}>
              {x.label} {b[x.key] ?? 0}/{x.max}
            </span>
          ))}
          {b.taste ? (
            <span
              className={cn("rounded-md px-1.5 py-0.5 font-mono text-[10px]", b.taste > 0 ? "bg-ok/12 text-ok" : "bg-bad/15 text-bad")}
              title="From your 👍/👎 on this channel and the AI's read of your taste"
            >
              Your taste {b.taste > 0 ? "+" : ""}
              {b.taste}
            </span>
          ) : null}
          {b.competition ? <span className="rounded-md bg-bad/15 px-1.5 py-0.5 font-mono text-[10px] text-bad">Competition {b.competition}</span> : null}
        </div>

        {v.aiNote && <p className="text-[13px] leading-relaxed text-muted">✨ {v.aiNote}</p>}
        {v.fitWhy && v.fit != null && (
          <p className={cn("text-xs", v.fit >= 60 ? "text-ok" : v.fit <= 40 ? "text-bad" : "text-faint")}>
            🎯 {v.fit >= 60 ? "Your taste" : v.fit <= 40 ? "Probably not for you" : "Neutral"}: {v.fitWhy}
          </p>
        )}

        {moments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {moments.map((m, i) => (
              <a
                key={`${m.source}-${m.t}-${i}`}
                href={yt(m.t)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-line-strong px-2 py-1 text-[11px] text-muted hover:text-fg"
                title={m.label}
              >
                <span>{SOURCE_LABEL[m.source] ?? "•"}</span>
                <span className="font-mono text-fg">{fmtT(m.t)}</span>
                <span className="max-w-[200px] truncate">{m.label}</span>
                {m.mentions > 1 && m.source === "comments" && <span className="text-faint">×{m.mentions}</span>}
              </a>
            ))}
          </div>
        )}

        {askRights && (
          <label className="flex items-start gap-2 text-xs text-muted">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 accent-[var(--color-fg)]" />
            I own this video or have permission to use it. Clipping other people&apos;s videos can break YouTube&apos;s terms and copyright law.
          </label>
        )}
        {error && <p className="text-xs text-bad">{error}</p>}

        <Rating v={v} />

        <div className="flex flex-wrap items-center gap-1.5">
          {v.status === "clipped" && v.clipSourceId ? (
            <Button size="sm" onClick={() => router.push(`/dashboard/clips/${v.clipSourceId}`)}>
              <Check size={13} /> Open clips
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy === "clip" || (askRights && !rights)}
              onClick={() => {
                if (!askRights) return setAskRights(true);
                run("clip", async () => {
                  await clipThis({ id: v._id as Id<"scoutVideos">, rightsConfirmed: rights });
                  router.push("/dashboard/clips");
                });
              }}
            >
              {busy === "clip" ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
              {askRights ? "Confirm & clip" : "Clip this"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || v.busy === "heatmap"}
            onClick={() =>
              run("heatmap", async () => {
                const n = await findMoments({ id: v._id });
                if (n === 0) setError("YouTube hasn't built a replay graph for this video yet (it appears once enough people have watched). Try again in a few days.");
              })
            }
            title="YouTube's most-replayed parts (about half a cent)"
          >
            {busy === "heatmap" || v.busy === "heatmap" ? <Loader2 size={13} className="animate-spin" /> : <Flame size={13} />}
            {v.heatmapAt ? "Refresh replays" : "Most replayed"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || v.busy === "competition"}
            onClick={() => run("competition", () => checkCompetition({ id: v._id }))}
            title="How many Shorts already clip this video (uses YouTube quota)"
          >
            {busy === "competition" || v.busy === "competition" ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
            Competition
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStatus({ id: v._id, status: v.status === "saved" ? "new" : "saved" })}>
            <Bookmark size={13} /> {v.status === "saved" ? "Unsave" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStatus({ id: v._id, status: "dismissed" })}>
            <X size={13} /> Dismiss
          </Button>
          <a href={yt()} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-8 items-center gap-1 px-1 text-xs text-faint hover:text-fg">
            YouTube <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </li>
  );
}

export default function ScoutPage() {
  const [status, setStatus] = useState<Status>("new");
  const [minScore, setMinScore] = useState(0);
  const [friendly, setFriendly] = useState(false);
  const [sort, setSort] = useState<"score" | "views" | "velocity">("score");
  const [minViews, setMinViews] = useState(0);
  const videos = useQuery(api.scout.list, {
    status: status === "new" ? undefined : status,
    minScore,
    clipFriendlyOnly: friendly,
    sort,
    minViews,
  });
  const settings = useQuery(api.settings.get);
  const windowLabel = (d: number) => (d >= 365 ? "last year" : `last ${d} days`);
  const summary = useQuery(api.scout.summary);
  const counts = useQuery(api.scout.counts);
  const n = (k: "new" | "saved" | "clipped" | "dismissed") => (counts ? ` ${counts[k]}` : "");
  const scanNow = useAction(api.scoutNode.scanNow);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <div className="grid gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">Clips</h1>
          <p className="mt-1 text-sm text-muted">Discover long YouTube videos with moments worth clipping, ranked by clip score.</p>
        </div>
        <ClipsTabs />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-faint">
            Watching your keywords and channels · scans every 6 hours
            {settings ? ` · ${windowLabel(settings.discoverWindowDays)}${settings.discoverLanguage === "en" ? " · English only" : ""}` : ""}
            {summary ? ` · learning from ${summary.rated} rating${summary.rated === 1 ? "" : "s"}` : ""}
          </span>
          <Button
            disabled={scanning || summary?.hasKey === false}
            onClick={async () => {
              setScanning(true);
              setScanMsg(null);
              try {
                const r = await scanNow({});
                setScanMsg(`Checked ${r.found} video${r.found === 1 ? "" : "s"}.`);
              } catch (e) {
                setScanMsg(errText(e));
              } finally {
                setScanning(false);
              }
            }}
          >
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <Radar size={15} />} Scan now
          </Button>
        </div>
        {summary && (
          <div className="grid gap-1.5 sm:max-w-md">
            <div className="flex justify-between text-xs text-faint">
              <span>YouTube quota today (whole app)</span>
              <span className="font-mono tabular">
                {summary.unitsToday.toLocaleString()} / {summary.unitsLimit.toLocaleString()}
              </span>
            </div>
            <Bar value={(summary.unitsToday / summary.unitsLimit) * 100} tone={summary.unitsToday > summary.scanLimit ? "bad" : "accent"} />
            <span className="text-xs text-faint">Scout spend this month ${summary.spendMonth.toFixed(2)}</span>
          </div>
        )}
        {summary?.hasKey === false && (
          <p className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-accent">
            The YouTube API key isn&apos;t set up yet, so scans are paused.
          </p>
        )}
        {scanMsg && <p className="text-xs text-muted">{scanMsg}</p>}
      </div>

      {counts && counts.total > 0 && (
        <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-line sm:grid-cols-4">
          {[
            { label: "Suggestions", value: counts.new + counts.saved, hint: "Found + saved, waiting for you" },
            { label: "New in 24h", value: counts.today, hint: "Found in the last 24 hours" },
            { label: "Score 70+", value: counts.strong, hint: "Strong picks waiting for you" },
            { label: "Clipped", value: counts.clipped, hint: "Sent to Clips" },
          ].map((x, i) => (
            <div
              key={x.label}
              title={x.hint}
              className={cn("grid gap-0.5 px-4 py-3", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line sm:border-t-0", i === 2 && "sm:border-l")}
            >
              <span className="text-xs text-faint">{x.label}</span>
              <span className="text-xl font-semibold tabular">{x.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      <Targets />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          label="Show"
          value={status}
          onChange={(s) => setStatus(s as Status)}
          options={[
            { value: "new", label: `Found${counts ? ` ${counts.new + counts.saved}` : ""}` },
            { value: "saved", label: `Saved${n("saved")}` },
            { value: "clipped", label: `Clipped${n("clipped")}` },
            { value: "dismissed", label: `Dismissed${n("dismissed")}` },
          ]}
        />
        <Segmented
          size="sm"
          label="Minimum score"
          value={String(minScore)}
          onChange={(s) => setMinScore(Number(s))}
          options={[
            { value: "0", label: "All" },
            { value: "50", label: "50+" },
            { value: "70", label: "70+" },
          ]}
        />
        <Chip pressed={friendly} onClick={() => setFriendly(!friendly)}>
          Clip-friendly only
        </Chip>
      </div>
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          label="Sort by"
          value={sort}
          onChange={(x) => setSort(x as "score" | "views" | "velocity")}
          options={[
            { value: "score", label: "Clip score" },
            { value: "views", label: "Most views" },
            { value: "velocity", label: "Fastest growing", title: "Views per hour since upload" },
          ]}
        />
        <Segmented
          size="sm"
          label="Minimum views"
          value={String(minViews)}
          onChange={(x) => setMinViews(Number(x))}
          options={[
            { value: "0", label: "Any views" },
            { value: "100000", label: "100K+" },
            { value: "1000000", label: "1M+" },
          ]}
        />
        <Link href="/dashboard/settings" className="min-h-8 px-1 text-[11px] text-faint hover:text-fg">
          Time window & language
        </Link>
      </div>

      {videos === undefined ? (
        <Loader2 className="animate-spin text-faint" />
      ) : videos.length === 0 ? (
        <p className="text-sm text-faint">
          Nothing here yet. Add keywords or channels above, then press <b className="text-muted">Scan now</b>.
        </p>
      ) : (
        <ul className="grid gap-3">
          {videos.map((v: Doc<"scoutVideos">) => (
            <VideoCard key={v._id} v={v} />
          ))}
        </ul>
      )}
      <p className="text-[11px] text-faint">
        💬 timestamped comments · 🔥 most replayed · ✨ AI. Only clip videos you own or have permission to use.
      </p>
    </div>
  );
}
