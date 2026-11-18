"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Clapperboard, Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/kit";
import { AI_VIDEO_MODELS, type AiVideoModel, type SmartBroll, type SmartEdit } from "@/types/clip";

const errMsg = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e);

type ShotContext = { clipTitle: string; aspect: string; words: { w: string; s: number; e: number }[] };

// What a cutaway already "says": template text or stock query, for the prompt writer.
function brollIdea(item: SmartBroll): string {
  if (item.query) return item.query;
  const p = item.props ?? {};
  const parts: string[] = [];
  for (const k of ["title", "subtitle", "text", "quote", "label", "metric"]) if (typeof p[k] === "string") parts.push(p[k] as string);
  if (p.value !== undefined) parts.unshift(String(p.value));
  for (const k of ["lines", "items", "steps"]) if (Array.isArray(p[k])) parts.push((p[k] as unknown[]).map(String).join(", "));
  return [item.template, ...parts].filter(Boolean).join(": ");
}

// Generate an AI B-roll shot (Higgsfield) for one B-roll item. Paid: shows the
// price first and only runs on an explicit click. The prompt is suggested by AI
// from what is said at that moment.
function AiShot({ clipId, item, ctx }: { clipId: Id<"clips">; item: SmartBroll; ctx: ShotContext }) {
  const estimate = useAction(api.aiBrollNode.estimate);
  const generate = useAction(api.aiBrollNode.generate);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(item.ai?.prompt ?? item.prompt ?? "");
  const [suggesting, setSuggesting] = useState(false);

  const suggest = async () => {
    setSuggesting(true);
    setError(null);
    try {
      // What is said from 4 s before to 4 s after the cutaway.
      const spoken = ctx.words
        .filter((w) => w.e >= item.t - 4 && w.s <= item.t + item.dur + 4)
        .map((w) => w.w)
        .join(" ");
      const res = await fetch("/api/clips/broll-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipTitle: ctx.clipTitle, spoken, idea: brollIdea(item), aspect: ctx.aspect, seconds: item.dur }),
      });
      const data = (await res.json()) as { prompt?: string; error?: string };
      if (!res.ok || !data.prompt) throw new Error(data.error || "Could not suggest a prompt");
      setPrompt(data.prompt);
      setPrice(undefined);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSuggesting(false);
    }
  };
  const [model, setModel] = useState<AiVideoModel>(item.ai?.model ?? "kling-3-std");
  const [price, setPrice] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the form with nothing written: suggest a prompt straight away.
  useEffect(() => {
    if (open && !prompt.trim() && !suggesting) void suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (item.ai?.status === "generating") {
    return (
      <div className="inline-flex items-center gap-1 pl-6 text-xs text-accent">
        <Loader2 size={12} className="animate-spin" /> Generating AI shot… (usually 1–3 min)
      </div>
    );
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex min-h-8 items-center gap-1 pl-6 text-left text-xs text-muted hover:text-fg">
        <Sparkles size={12} /> {item.kind === "ai" ? "Regenerate AI shot" : "Replace with AI shot"}
        {item.ai?.status === "failed" ? <span className="text-bad"> · last attempt failed: {item.ai.error}</span> : null}
      </button>
    );
  }
  return (
    <div className="ml-6 space-y-2 rounded-[10px] border border-line-strong bg-bg p-2.5">
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setPrice(undefined);
          }}
          rows={3}
          disabled={suggesting}
          placeholder={suggesting ? "Writing a prompt from what's said here…" : "Describe the shot, e.g. slow push-in on a busy coffee shop counter at sunrise"}
          className="w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-base text-fg outline-none focus:border-neutral-600 disabled:opacity-60 sm:text-xs"
        />
        {suggesting && <Loader2 size={14} className="absolute right-2 top-2 animate-spin text-accent" />}
      </div>
      <button
        onClick={suggest}
        disabled={suggesting}
        className="inline-flex min-h-8 items-center gap-1 text-xs text-muted hover:text-fg disabled:opacity-50"
      >
        <Sparkles size={12} /> {prompt.trim() ? "Suggest another" : "Suggest a prompt"}
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value as AiVideoModel);
            setPrice(undefined);
          }}
          className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-base text-fg sm:text-xs"
        >
          {Object.entries(AI_VIDEO_MODELS).map(([k, m]) => (
            <option key={k} value={k}>{m.label} (min {m.minSec}s)</option>
          ))}
        </select>
        {price === undefined ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !prompt.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setPrice(await estimate({ clipId, brollId: item.id, prompt, model }));
              } catch (e) {
                setError(errMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : "Check price"}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || !prompt.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await generate({ clipId, brollId: item.id, prompt, model });
                setOpen(false);
              } catch (e) {
                setError(errMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : `Generate${price !== null ? ` · $${price.toFixed(2)}` : ""}`}
          </Button>
        )}
        <button onClick={() => setOpen(false)} className="h-8 px-1 text-xs text-faint hover:text-fg">Cancel</button>
      </div>
      {price === null && <p className="text-xs text-faint">Price unavailable — you can still generate.</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

const THEMES = [
  { key: "tech", label: "Tech" },
  { key: "hype", label: "Hype" },
  { key: "editorial", label: "Editorial" },
  { key: "warm", label: "Warm" },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  if (!label) return <Switch checked={on} onChange={onChange} label="Turn on or off" />;
  return (
    <div className="flex items-center justify-between gap-2.5 text-sm">
      <span>{label}</span>
      <Switch checked={on} onChange={onChange} label={label} />
    </div>
  );
}

// One inspector option (".opt" in the design): title + switch, then details.
function Section({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line px-4 py-3">
      <div className="flex items-center justify-between gap-2.5">
        <h3 className="text-sm">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-8 cursor-pointer items-center gap-2 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs",
        on ? "text-muted" : "text-faint line-through"
      )}
    >
      <input type="checkbox" checked={on} onChange={onToggle} className="h-3.5 w-3.5 flex-shrink-0 accent-[var(--color-fg)]" />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}

export function SmartPanel({
  clipId,
  clipTitle,
  words,
  smart,
  status,
  error,
  start,
  end,
  aspect,
  onChange,
  onRegenerate,
}: {
  clipId: Id<"clips">;
  clipTitle: string;
  words: { w: string; s: number; e: number }[];
  smart: SmartEdit | null;
  status: string | undefined;
  error: string | null | undefined;
  start: number;
  end: number;
  aspect: string;
  onChange: (next: SmartEdit) => void;
  onRegenerate: () => void;
}) {
  const working = status === "queued" || status === "processing";

  if (!smart) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
          <h3 className="text-sm font-semibold">Smart edits</h3>
          <Button size="sm" onClick={onRegenerate} disabled={working}>
            {working ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
            {working ? "Generating…" : "Generate"}
          </Button>
        </div>
        <p className={cn("px-4 py-3 text-xs", status === "failed" ? "text-bad" : "text-faint")}>
          {working
            ? "The AI is cutting silences, tracking the speaker and planning zooms, highlights and B-roll…"
            : status === "failed"
              ? `Smart edit failed: ${error ?? "unknown error"}`
              : "Let the AI cut silences and fillers, follow the speaker, add zooms, highlights, B-roll and a hook."}
        </p>
      </div>
    );
  }

  const set = (patch: Partial<SmartEdit>) => onChange({ ...smart, ...patch });
  const inRange = <T extends { t?: number; s?: number }>(x: T) => {
    const t = x.t ?? x.s ?? 0;
    return t >= start && t <= end;
  };

  const removals = smart.removals.filter((r) => r.e > start && r.s < end);
  const cutSeconds = removals
    .filter((r) => r.enabled)
    .reduce((sum, r) => sum + Math.min(end, r.e) - Math.max(start, r.s), 0);
  const count = (reason: string) => removals.filter((r) => r.enabled && r.reason === reason).length;
  const zooms = smart.zooms.filter(inRange);
  const highlights = smart.highlights.filter(inRange);
  const broll = smart.broll.filter(inRange);

  const toggleIn = <K extends "removals" | "zooms" | "highlights" | "broll">(key: K, id: string) =>
    set({ [key]: (smart[key] as { id: string; enabled: boolean }[]).map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)) } as Partial<SmartEdit>);
  const setAll = <K extends "removals" | "zooms" | "highlights" | "broll">(key: K, on: boolean, filter?: (x: SmartEdit[K][number]) => boolean) =>
    set({ [key]: (smart[key] as SmartEdit[K][number][]).map((x) => (!filter || filter(x) ? { ...x, enabled: on } : x)) } as Partial<SmartEdit>);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
        <h3 className="text-sm font-semibold">Smart edits</h3>
        <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={working}>
          {working ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
          {working ? "Regenerating…" : "Regenerate"}
        </Button>
      </div>
      {status === "failed" && <p className="border-b border-line px-4 py-2 text-xs text-bad">Last regenerate failed: {error}</p>}

      <Section title="Auto reframe" right={<Toggle on={smart.reframe.enabled} onChange={(v) => set({ reframe: { ...smart.reframe, enabled: v } })} />}>
        <p className="text-xs text-faint">
          {aspect === "16:9"
            ? "Not needed for 16:9."
            : smart.reframe.track.length
              ? `Following the speaker's face (${smart.reframe.track.length} keyframes).`
              : "No face found — using the manual frame position below."}
        </p>
      </Section>

      <Section
        title="Cut silences & fillers"
        right={
          <Toggle
            on={removals.some((r) => r.enabled)}
            onChange={(v) => setAll("removals", v, (r) => r.e > start && r.s < end)}
          />
        }
      >
        <p className="text-xs text-faint">
          Removed {cutSeconds.toFixed(1)}s — {count("silence")} silences, {count("filler")} fillers, {count("repeat")} repeats.
        </p>
        <details>
          <summary className="cursor-pointer text-xs text-faint hover:text-muted">Show cuts ({removals.length})</summary>
          <div className="mt-1.5 grid max-h-40 gap-1 overflow-y-auto">
            {removals.map((r) => (
              <Row key={r.id} on={r.enabled} onToggle={() => toggleIn("removals", r.id)}>
                {fmt(r.s)} · {(r.e - r.s).toFixed(1)}s · {r.reason}
              </Row>
            ))}
          </div>
        </details>
      </Section>

      <Section title="Zooms" right={<Toggle on={zooms.some((z) => z.enabled)} onChange={(v) => setAll("zooms", v)} />}>
        {zooms.length === 0 ? (
          <p className="text-xs text-faint">No zooms planned.</p>
        ) : (
          zooms.map((z) => (
            <Row key={z.id} on={z.enabled} onToggle={() => toggleIn("zooms", z.id)}>
              {fmt(z.t)} · {z.dur.toFixed(1)}s · {Math.round((z.scale - 1) * 100)}% punch-in
            </Row>
          ))
        )}
      </Section>

      <Section title="Highlights & emojis" right={<Toggle on={highlights.some((h) => h.enabled)} onChange={(v) => setAll("highlights", v)} />}>
        {highlights.length === 0 ? (
          <p className="text-xs text-faint">No highlights planned.</p>
        ) : (
          highlights.map((h) => (
            <div key={h.id} className="flex items-center gap-2 [&>label]:flex-1">
              <Row on={h.enabled} onToggle={() => toggleIn("highlights", h.id)}>
                <span style={{ color: h.color }} className="font-semibold">{h.word}</span>
              </Row>
              <input
                value={h.emoji ?? ""}
                placeholder="emoji"
                onChange={(e) =>
                  set({ highlights: smart.highlights.map((x) => (x.id === h.id ? { ...x, emoji: e.target.value || null } : x)) })
                }
                className="h-8 w-16 flex-shrink-0 rounded-lg border border-line-strong bg-bg px-2 text-base text-fg sm:text-xs"
              />
            </div>
          ))
        )}
      </Section>

      <Section title="B-roll" right={<Toggle on={broll.some((b) => b.enabled)} onChange={(v) => setAll("broll", v, (b) => b.kind === "template" || !!b.assetUrl)} />}>
        {broll.length === 0 ? (
          <p className="text-xs text-faint">No B-roll planned.</p>
        ) : (
          broll.map((b) => (
            <div key={b.id} className="grid gap-1">
              <Row on={b.enabled} onToggle={() => toggleIn("broll", b.id)}>
                {fmt(b.t)} · {b.dur.toFixed(1)}s ·{" "}
                {b.kind === "ai"
                  ? `AI shot: ${b.ai?.prompt ?? ""}`
                  : b.kind === "template"
                    ? b.template
                    : b.assetUrl
                      ? `Stock: ${b.query}`
                      : `Stock: ${b.query} (needs Pexels key)`}
              </Row>
              <AiShot clipId={clipId} item={b} ctx={{ clipTitle, aspect, words }} />
            </div>
          ))
        )}
        <button
          onClick={() =>
            set({
              broll: [
                ...smart.broll,
                {
                  id: `ai${Date.now().toString(36)}`,
                  t: Math.min(end - 3, start + Math.max(2, (end - start) / 2)),
                  dur: 3,
                  kind: "ai",
                  enabled: false,
                  ai: null,
                },
              ],
            })
          }
          className="inline-flex min-h-8 items-center gap-1 justify-self-start text-xs text-muted hover:text-fg"
        >
          <Plus size={12} /> <Clapperboard size={12} /> Add AI shot (mid-clip)
        </button>
        <div className="flex items-center gap-2 text-xs text-faint">
          Style
          <select
            value={smart.theme}
            onChange={(e) => set({ theme: e.target.value })}
            className="h-8 rounded-lg border border-line-strong bg-bg px-2 text-base text-fg sm:text-xs"
          >
            {THEMES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
      </Section>

      <Section title="Hook title" right={<Toggle on={smart.hook.enabled} onChange={(v) => set({ hook: { ...smart.hook, enabled: v } })} />}>
        <input
          value={smart.hook.text}
          onChange={(e) => set({ hook: { ...smart.hook, text: e.target.value.slice(0, 80) } })}
          className="h-9 w-full rounded-[10px] border border-line-strong bg-bg px-3 text-base text-fg outline-none focus:border-neutral-600 sm:text-sm"
        />
      </Section>

      <Section title="Animations">
        <div className="flex flex-col gap-2">
          <Toggle on={smart.anim.progressBar} onChange={(v) => set({ anim: { ...smart.anim, progressBar: v } })} label="Progress bar" />
          <Toggle on={smart.anim.cutPunch} onChange={(v) => set({ anim: { ...smart.anim, cutPunch: v } })} label="Punch-in on jump cuts" />
          <Toggle
            on={smart.anim.endCta.enabled}
            onChange={(v) => set({ anim: { ...smart.anim, endCta: { ...smart.anim.endCta, enabled: v } } })}
            label="End call to action"
          />
          {smart.anim.endCta.enabled && (
            <input
              value={smart.anim.endCta.text}
              onChange={(e) => set({ anim: { ...smart.anim, endCta: { ...smart.anim.endCta, text: e.target.value.slice(0, 60) } } })}
              className="h-9 w-full rounded-[10px] border border-line-strong bg-bg px-3 text-base text-fg outline-none focus:border-neutral-600 sm:text-sm"
            />
          )}
        </div>
      </Section>
    </div>
  );
}
