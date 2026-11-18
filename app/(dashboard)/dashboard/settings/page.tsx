"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { UserProfile } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Panel, PanelBody, PanelHeader, Segmented } from "@/components/ui/kit";
import { STORY_LENGTHS, STORY_VOICES } from "@/types/story";
import { SCOUT_NICHES } from "@/convex/scoutLib";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Settings = FunctionReturnType<typeof api.settings.get>;
type Patch = Partial<Omit<Settings, "updatedAt">>;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-3.5 last:border-b-0 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-xs text-faint">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return (
    <span
      role="status"
      className={cn("text-xs", state === "saved" ? "text-ok" : state === "error" ? "text-bad" : "text-faint")}
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Couldn't save"}
    </span>
  );
}

function Defaults() {
  const server = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);
  const [local, setLocal] = useState<Patch>({});
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (server === undefined) {
    return (
      <Panel>
        <PanelHeader title="Defaults" />
        <PanelBody>
          <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
        </PanelBody>
      </Panel>
    );
  }

  const s = { ...server, ...local };

  async function save(patch: Patch) {
    setLocal((l) => ({ ...l, ...patch }));
    setState("saving");
    window.clearTimeout(timer.current);
    try {
      await update(patch);
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      setLocal((l) => {
        const next = { ...l };
        for (const k of Object.keys(patch) as (keyof Patch)[]) delete next[k];
        return next;
      });
    }
  }

  return (
    <Panel>
      <PanelHeader title="Defaults">
        <SaveState state={state} />
      </PanelHeader>
      <PanelBody>
        <p className="mb-4 text-sm text-muted">Starting values for new stories, clips and downloads. You can still change them on each one.</p>

        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Story Studio</h4>
        <div className="mb-6">
          <Row label="Narrator voice">
            <select
              value={s.defaultNarratorVoice}
              onChange={(e) => save({ defaultNarratorVoice: e.target.value })}
              aria-label="Narrator voice"
              className="h-9 w-full max-w-xs rounded-[9px] border border-line bg-bg px-2.5 text-base text-fg outline-none focus:border-line-strong sm:text-sm"
            >
              {STORY_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Format">
            <Segmented
              label="Story format"
              className="max-w-xs"
              value={s.defaultStoryAspect}
              onChange={(v) => save({ defaultStoryAspect: v })}
              options={[
                { value: "9:16", label: "9:16 vertical" },
                { value: "16:9", label: "16:9 wide" },
              ]}
            />
          </Row>
          <Row label="Length">
            <Segmented
              label="Story length"
              className="max-w-sm"
              value={String(s.defaultStoryLength)}
              onChange={(v) => save({ defaultStoryLength: Number(v) })}
              options={STORY_LENGTHS.map((n) => ({ value: String(n), label: n >= 120 ? `${n / 60} min` : `${n}s` }))}
            />
          </Row>
        </div>

        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Clips</h4>
        <div>
          <Row label="Aspect ratio">
            <Segmented
              label="Clip aspect ratio"
              className="max-w-xs"
              value={s.defaultClipAspect}
              onChange={(v) => save({ defaultClipAspect: v })}
              options={[
                { value: "9:16", label: "9:16" },
                { value: "1:1", label: "1:1" },
                { value: "16:9", label: "16:9" },
              ]}
            />
          </Row>
          <Row label="Framing" hint="Fit shows the whole frame; fill crops and follows the face.">
            <Segmented
              label="Clip framing"
              className="max-w-xs"
              value={s.defaultFraming}
              onChange={(v) => save({ defaultFraming: v })}
              options={[
                { value: "fit", label: "Fit" },
                { value: "fill", label: "Fill" },
              ]}
            />
          </Row>
          <Row label="Fit background" hint="What fills the space around a fitted video.">
            <Segmented
              label="Fit background"
              className="max-w-xs"
              value={s.defaultFitBackground}
              onChange={(v) => save({ defaultFitBackground: v })}
              options={[
                { value: "blur", label: "Blur", disabled: s.defaultFraming === "fill" },
                { value: "black", label: "Black", disabled: s.defaultFraming === "fill" },
              ]}
            />
          </Row>
          <Row label="Caption style">
            <Segmented
              label="Caption style"
              className="max-w-sm"
              value={s.defaultCaptionStyle}
              onChange={(v) => save({ defaultCaptionStyle: v })}
              options={[
                { value: "bold", label: "Bold" },
                { value: "karaoke", label: "Karaoke" },
                { value: "clean", label: "Clean" },
                { value: "none", label: "None" },
              ]}
            />
          </Row>
          <Row label="YouTube download quality" hint="Higher quality takes longer to download.">
            <Segmented
              label="YouTube download quality"
              className="max-w-sm"
              value={s.defaultDownloadQuality}
              onChange={(v) => save({ defaultDownloadQuality: v })}
              options={(["360", "480", "720", "1080"] as const).map((q) => ({ value: q, label: `${q}p` }))}
            />
          </Row>
        </div>
      </PanelBody>
    </Panel>
  );
}

// Clip niches: guide Discover (niche picker order, AI keyword ideas, taste fit).
function Niches() {
  const server = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);
  const [local, setLocal] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const niches = local ?? server?.niches ?? [];
  const has = (n: string) => niches.some((x) => x.toLowerCase() === n.toLowerCase());
  const presetLabels = new Set(SCOUT_NICHES.map((n) => n.label.toLowerCase()));
  const custom = niches.filter((n) => !presetLabels.has(n.toLowerCase()));

  async function save(next: string[]) {
    setLocal(next);
    setState("saving");
    window.clearTimeout(timer.current);
    try {
      await update({ niches: next });
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      setLocal(null);
    }
  }
  async function saveSetting(patch: { discoverWindowDays?: number; discoverLanguage?: "en" | "any" }) {
    setState("saving");
    window.clearTimeout(timer.current);
    try {
      await update(patch);
      setState("saved");
      timer.current = window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }
  const toggle = (n: string) => save(has(n) ? niches.filter((x) => x.toLowerCase() !== n.toLowerCase()) : [...niches, n]);
  const addCustom = () => {
    const n = text.replace(/\s+/g, " ").trim().slice(0, 40);
    if (n.length < 2 || has(n) || niches.length >= 12) return;
    setText("");
    save([...niches, n]);
  };

  return (
    <Panel>
      <PanelHeader title="Discover">
        <SaveState state={state} />
      </PanelHeader>
      <PanelBody className="grid gap-4">
        {server && (
          <div>
            <Row label="Time window" hint="How far back keyword scans look. Longer finds big viral videos; newer ones have less competition.">
              <Segmented
                label="Discover time window"
                className="max-w-sm"
                value={String(server.discoverWindowDays)}
                onChange={(d) => saveSetting({ discoverWindowDays: Number(d) })}
                options={[
                  { value: "7", label: "7 days" },
                  { value: "30", label: "30 days" },
                  { value: "90", label: "90 days" },
                  { value: "365", label: "1 year" },
                ]}
              />
            </Row>
            <Row
              label="Language"
              hint="English only hides videos with non-English titles or descriptions, and channels based outside English-speaking countries. Channels you watch are always kept."
            >
              <Segmented
                label="Discover language"
                className="max-w-xs"
                value={server.discoverLanguage}
                onChange={(l) => saveSetting({ discoverLanguage: l as "en" | "any" })}
                options={[
                  { value: "en", label: "English only" },
                  { value: "any", label: "Any language" },
                ]}
              />
            </Row>
          </div>
        )}
        <div className="text-sm font-semibold">Your niches</div>
        <p className="-mt-3 text-sm text-muted">
          What you clip. Discover shows these niches first, suggests keywords for them, and its AI ranks videos by how well they
          fit. Pick up to 12.
        </p>
        {server === undefined ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {SCOUT_NICHES.map((n) => {
                const on = has(n.label);
                return (
                  <button
                    key={n.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && niches.length >= 12}
                    onClick={() => toggle(n.label)}
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-40",
                      on ? "border-fg bg-surface-3 text-fg" : "border-line-strong text-muted hover:text-fg"
                    )}
                  >
                    <span>{n.emoji}</span> {n.label}
                  </button>
                );
              })}
              {custom.map((n) => (
                <span key={n} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-fg bg-surface-3 py-1 pl-2.5 pr-1.5 text-xs text-fg">
                  {n}
                  <button type="button" aria-label={`Remove ${n}`} onClick={() => toggle(n)} className="rounded-full p-0.5 text-faint hover:text-bad">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="flex max-w-md items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addCustom();
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={40}
                aria-label="Add your own niche"
                placeholder="Add your own, e.g. Nigerian comedy skits"
                className="h-9 min-w-0 flex-1 rounded-[9px] border border-line bg-bg px-2.5 text-base text-fg outline-none placeholder:text-faint focus:border-line-strong sm:text-sm"
              />
              <button
                type="submit"
                disabled={text.trim().length < 2 || niches.length >= 12}
                className="inline-flex h-9 items-center gap-1 rounded-[9px] border border-line-strong px-3 text-sm text-muted transition hover:text-fg disabled:opacity-40"
              >
                <Plus size={14} /> Add
              </button>
            </form>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function Learning() {
  const counts = useQuery(api.settings.learningCounts);
  const reset = useMutation(api.settings.resetLearning);
  const [step, setStep] = useState<"idle" | "confirm" | "working" | "done" | "error">("idle");

  async function run() {
    setStep("working");
    try {
      for (let i = 0; i < 50; i++) {
        const r = await reset();
        if (r.done) break;
      }
      setStep("done");
    } catch {
      setStep("error");
    }
  }

  const total = counts ? counts.clipRatings + counts.storyFeedback + counts.scoutRatings : 0;
  const cap = (n: number) => (n >= 1000 ? "1,000+" : n.toLocaleString());

  return (
    <Panel>
      <PanelHeader title="AI learning" />
      <PanelBody className="grid gap-4">
        <p className="text-sm text-muted">
          Every thumbs up or down, every reason you pick and every edit you make (rewrites, redrawn scenes, swapped voices,
          replaced clips) teaches the AI what you like. It uses your recent feedback when it finds clips, ranks Discover videos and writes stories.
        </p>
        <div className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-line">
          <div className="grid gap-0.5 px-4 py-3">
            <span className="text-xs text-faint">Clip ratings</span>
            <span className="text-xl font-semibold tabular">{counts ? cap(counts.clipRatings) : "–"}</span>
          </div>
          <div className="grid gap-0.5 border-l border-line px-4 py-3">
            <span className="text-xs text-faint">Story feedback</span>
            <span className="text-xl font-semibold tabular">{counts ? cap(counts.storyFeedback) : "–"}</span>
          </div>
          <div className="grid gap-0.5 border-l border-line px-4 py-3">
            <span className="text-xs text-faint">Discover ratings</span>
            <span className="text-xl font-semibold tabular">{counts ? cap(counts.scoutRatings) : "–"}</span>
          </div>
        </div>

        {step === "confirm" ? (
          <div className="grid gap-3 rounded-[10px] border border-bad/40 bg-bad/10 p-3.5">
            <p className="text-sm">
              This clears your clip and Discover ratings and deletes all story feedback. The AI goes back to its defaults. Clips you
              replaced stay hidden. This can&apos;t be undone.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={run}
                className="h-9 rounded-[9px] bg-bad px-3.5 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Yes, reset it
              </button>
              <button
                type="button"
                onClick={() => setStep("idle")}
                className="h-9 rounded-[9px] border border-line-strong px-3.5 text-sm text-muted transition hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={step === "working" || (counts !== undefined && total === 0)}
              onClick={() => setStep("confirm")}
              className="h-9 rounded-[9px] border border-line-strong px-3.5 text-sm font-semibold text-bad transition hover:border-bad/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {step === "working" ? "Resetting…" : "Reset what the AI learned"}
            </button>
            {step === "done" && <span role="status" className="text-xs text-ok">Done. The AI starts fresh.</span>}
            {step === "error" && <span role="status" className="text-xs text-bad">Couldn&apos;t reset. Try again.</span>}
            {step !== "done" && counts !== undefined && total === 0 && (
              <span className="text-xs text-faint">Nothing learned yet.</span>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-4xl gap-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted">Defaults for new work, what the AI has learned, and your account.</p>
      </div>
      <Defaults />
      <Niches />
      <Learning />
      <Panel className="overflow-hidden">
        <PanelHeader title="Account" />
        <div className="min-w-0 overflow-x-auto">
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: "w-full",
                cardBox: "w-full max-w-none shadow-none border-0 rounded-none",
              },
            }}
          />
        </div>
      </Panel>
    </div>
  );
}
