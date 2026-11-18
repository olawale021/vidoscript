"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Chip, Eyebrow, Segmented } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { errText, fmtLength } from "./_components/util";
import { VoicePicker } from "./_components/voice-picker";
import { STORY_LENGTHS, STORY_STEPS, STORY_STYLES, STORY_VOICES, type StoryAspect } from "@/types/story";

const EXAMPLES = [
  { short: "A message in a bottle from himself", full: "A lighthouse keeper finds a message in a bottle written by himself, 40 years in the future." },
  { short: "A street cat in Lagos runs the lost-and-found", full: "A street cat in Lagos secretly runs the neighbourhood's lost-and-found." },
  { short: "The last tree on Mars grows strange fruit", full: "The last tree on Mars starts growing fruit nobody has ever seen." },
];

const LEARNED = [
  ["script", "Scripts"],
  ["plan", "Shot plans"],
  ["still", "Pictures"],
  ["voice", "Voices"],
  ["video", "Finished videos"],
] as const;

const field =
  "w-full rounded-[10px] bg-surface border border-line px-3 py-2 text-base sm:text-sm text-fg placeholder:text-faint focus:outline-none focus:border-line-strong";

export default function StoriesPage() {
  const router = useRouter();
  const stories = useQuery(api.stories.list);
  const learned = useQuery(api.storyFeedback.summary);
  const resetLearning = useMutation(api.storyFeedback.reset);
  const [voiceTouched, setVoiceTouched] = useState(false);
  const create = useMutation(api.stories.create);
  const [idea, setIdea] = useState("");
  const [aspect, setAspect] = useState<StoryAspect>("9:16");
  const [targetSec, setTargetSec] = useState(60);
  const [style, setStyle] = useState("cinematic");
  const [styleNotes, setStyleNotes] = useState("");
  const [voice, setVoice] = useState("onyx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the narrator voice they've liked most.
  // Starting values: the user's saved defaults (Settings) win; otherwise the
  // narrator voice they've liked most.
  const defaults = useQuery(api.settings.get);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  useEffect(() => {
    if (!defaults || defaultsApplied) return;
    setDefaultsApplied(true);
    if (!defaults.updatedAt) return;
    setAspect(defaults.defaultStoryAspect);
    setTargetSec(defaults.defaultStoryLength);
    if (!voiceTouched) {
      setVoice(defaults.defaultNarratorVoice);
      setVoiceTouched(true);
    }
  }, [defaults, defaultsApplied, voiceTouched]);
  useEffect(() => {
    if (!voiceTouched && learned?.favouriteVoice) setVoice(learned.favouriteVoice);
  }, [learned?.favouriteVoice, voiceTouched]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const id = await create({ idea, aspect, targetSec, style, styleNotes, narratorVoice: voice });
      router.push(`/dashboard/stories/${id}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const mins = targetSec / 60;

  return (
    <div className="max-w-6xl mx-auto grid gap-6 sm:gap-7 min-w-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Stories</h1>
        <p className="text-sm text-muted mt-1">
          Turn one idea into a narrated video. You approve each step before anything costly runs.
        </p>
      </div>

      {/* Idea */}
      <div className="rounded-[18px] border border-line-strong bg-surface p-1.5">
        <textarea
          id="idea"
          aria-label="Story idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={EXAMPLES[0].full}
          className="w-full min-h-[104px] resize-y bg-transparent border-0 outline-none text-fg text-lg leading-[1.45] tracking-[-0.01em] px-3.5 pt-3.5 pb-1.5 placeholder:text-faint"
        />
        <div className="flex flex-wrap items-center justify-between gap-2.5 pl-3.5 pr-2 pt-2 pb-1.5">
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {EXAMPLES.map((x) => (
              <Chip key={x.short} onClick={() => setIdea(x.full)} className="min-h-8 text-left">
                {x.short}
              </Chip>
            ))}
          </div>
          <Button onClick={submit} disabled={busy || idea.trim().length < 5} className="max-sm:w-full">
            {busy && <Loader2 size={16} className="animate-spin" />}
            Write the script
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-bad -mt-3">{error}</p>}

      {/* Options */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-[auto_auto_1fr] lg:gap-6 items-start">
        <div className="grid gap-2 min-w-0">
          <Eyebrow>Format</Eyebrow>
          <Segmented
            label="Format"
            value={aspect}
            onChange={setAspect}
            options={[
              { value: "9:16", label: "9:16 Shorts" },
              { value: "16:9", label: "16:9 YouTube" },
            ]}
          />
        </div>
        <div className="grid gap-2 min-w-0">
          <Eyebrow>Length</Eyebrow>
          <Segmented
            label="Length"
            value={String(targetSec)}
            onChange={(v) => setTargetSec(Number(v))}
            options={STORY_LENGTHS.map((s) => ({ value: String(s), label: fmtLength(s) }))}
          />
        </div>
        <div className="grid gap-2 min-w-0 md:col-span-2 lg:col-span-1">
          <Eyebrow>Estimated cost</Eyebrow>
          <p className="text-sm text-muted">
            <b className="text-fg tabular">
              ≈ ${(0.5 * mins).toFixed(2)}–{(1 * mins).toFixed(2)}
            </b>{" "}
            for pictures and voice. Script and plan are near free.
          </p>
        </div>
      </div>

      {/* Art style */}
      <div className="grid gap-2">
        <Eyebrow>Art style</Eyebrow>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5" role="radiogroup" aria-label="Art style">
          {Object.entries(STORY_STYLES).map(([id, s]) => {
            const on = style === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setStyle(id)}
                className={cn("grid gap-1.5 text-left text-[13px] min-w-0", on ? "text-fg" : "text-muted hover:text-fg")}
              >
                <span
                  className={cn(
                    "block aspect-[3/4] rounded-[10px] border-2 overflow-hidden bg-surface-2 transition-colors",
                    on ? "border-fg" : "border-transparent"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/styles/${id}.jpg`} alt="" loading="lazy" className="w-full h-full object-cover" />
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>
        <input
          value={styleNotes}
          onChange={(e) => setStyleNotes(e.target.value)}
          aria-label="Style notes"
          placeholder="Extra style notes (optional): moody teal and amber, 1970s"
          className={cn(field, "mt-1")}
        />
      </div>

      {/* Voice */}
      <div className="grid gap-2">
        <Eyebrow>
          Narrator voice{" "}
          <span className="normal-case tracking-normal font-medium">
            · {STORY_VOICES.length} voices · tap ▶ to listen
          </span>
        </Eyebrow>
        <VoicePicker
          value={voice}
          favourite={learned?.favouriteVoice}
          onChange={(id) => {
            setVoice(id);
            setVoiceTouched(true);
          }}
        />
      </div>

      {/* Learned */}
      {learned && learned.total > 0 && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-fg">
              What the AI has learned{" "}
              <span className="text-xs font-medium text-faint">from {learned.total} ratings and edits</span>
            </h2>
            <button
              onClick={async () => {
                if (!window.confirm("Forget everything the AI learned from your story feedback?")) return;
                await resetLearning({});
              }}
              className="text-xs text-faint hover:text-bad min-h-8 px-1"
            >
              Reset
            </button>
          </div>
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {LEARNED.map(([key, label]) => {
              const st = learned.stages[key];
              return (
                <li key={key} className="rounded-[10px] border border-line bg-surface px-3 py-2.5 grid gap-1 min-w-0 content-start">
                  <b className="text-[13px] font-semibold text-fg">{label}</b>
                  <span className="text-xs font-mono text-faint tabular">
                    ↑ {st?.up ?? 0} · ↓ {st?.down ?? 0}
                  </span>
                  <small className="text-xs text-muted">
                    {key === "voice" && learned.favouriteVoice
                      ? `Prefers ${STORY_VOICES.find((v) => v.id === learned.favouriteVoice)?.label.split(" · ")[0] ?? learned.favouriteVoice}`
                      : st && st.top.length > 0
                        ? st.top.map((t) => (t.count > 1 ? `${t.reason} ×${t.count}` : t.reason)).join(" · ")
                        : "Nothing yet"}
                  </small>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-faint">
            Your ratings, rewrite notes, redraws and voice changes shape every new script, plan, picture and voice.
          </p>
        </section>
      )}

      {/* Stories */}
      <SeriesSection />

      <section className="grid gap-3">
        <h2 className="text-base font-semibold text-fg">Your stories</h2>
        {stories === undefined ? (
          <Loader2 className="animate-spin text-faint" />
        ) : stories.length === 0 ? (
          <p className="text-sm text-faint">No stories yet. Write an idea above to start one.</p>
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {stories.map((s) => {
              const idx = STORY_STEPS.findIndex((x) => x.id === s.step);
              const reached = s.renderStatus === "done" ? 5 : idx + 1;
              return (
                <li key={s._id} className="min-w-0">
                  <Link href={`/dashboard/stories/${s._id}`} className="group grid gap-2 min-w-0">
                    <div
                      className={cn(
                        "relative rounded-[10px] border border-line bg-surface-2 overflow-hidden transition group-hover:border-line-strong",
                        s.aspect === "9:16" ? "aspect-[9/16]" : "aspect-video"
                      )}
                    >
                      {s.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.thumbUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-line-strong">
                          <BookOpen size={28} />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute left-2 right-2 bottom-2 flex gap-[3px]" aria-label={`Step ${reached} of 5`}>
                        {STORY_STEPS.map((x, i) => (
                          <i key={x.id} className={cn("flex-1 h-[3px] rounded-sm", i < reached ? "bg-white" : "bg-white/25")} />
                        ))}
                      </div>
                    </div>
                    <h4 className="text-sm font-semibold text-fg line-clamp-2">{s.title}</h4>
                    <span className="text-xs text-faint tabular -mt-1">
                      {s.renderStatus === "done" ? "Exported" : STORY_STEPS[idx]?.label} · {s.aspect} · ${s.costUsd.toFixed(2)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Phase 3a: saved casts. "New episode" starts a story with the same style,
// voice and characters (their pictures are reused, so no redraw cost).
function SeriesSection() {
  const router = useRouter();
  const series = useQuery(api.series.list);
  const newEpisode = useMutation(api.series.newEpisode);
  const removeSeries = useMutation(api.series.remove);
  const [openId, setOpenId] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!series || series.length === 0) return null;
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg inline-flex items-center gap-2">
          <Layers size={16} /> Series
        </h2>
        <span className="text-xs text-faint">Same characters in every episode</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((s) => (
          <li key={s._id} className="grid gap-3 rounded-[12px] border border-line bg-surface p-3.5 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg truncate">{s.title}</div>
                <div className="text-xs text-faint">
                  {s.episodes} episode{s.episodes === 1 ? "" : "s"} · {s.cast.length} character{s.cast.length === 1 ? "" : "s"} · {s.aspect}
                </div>
              </div>
              <button
                aria-label={`Delete series ${s.title}`}
                onClick={async () => {
                  if (!window.confirm(`Delete the series "${s.title}"? Its episodes are kept.`)) return;
                  await removeSeries({ seriesId: s._id });
                }}
                className="p-1.5 text-faint hover:text-bad"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex -space-x-2">
              {s.cast.map((c) =>
                c.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={c.id} src={c.url} alt={c.name} title={c.name} className="h-10 w-10 rounded-full border-2 border-surface object-cover object-top" />
                ) : (
                  <span key={c.id} title={c.name} className="grid h-10 w-10 place-items-center rounded-full border-2 border-surface bg-surface-3 text-xs">
                    {c.name[0]}
                  </span>
                )
              )}
            </div>
            {openId === s._id ? (
              <div className="grid gap-2">
                <textarea
                  aria-label="Episode idea"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={3}
                  placeholder="What happens in this episode?"
                  className="w-full rounded-lg border border-line-strong bg-bg px-3 py-2 text-base sm:text-sm text-fg placeholder:text-faint focus:outline-none focus:border-neutral-600"
                />
                {error && <p className="text-xs text-bad">{error}</p>}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || idea.trim().length < 5}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const id = await newEpisode({ seriesId: s._id, idea });
                        router.push(`/dashboard/stories/${id}`);
                      } catch (e) {
                        setError(errText(e));
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : null} Write the episode
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOpenId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { setOpenId(s._id); setIdea(""); setError(null); }}>
                <Plus size={13} /> New episode
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
