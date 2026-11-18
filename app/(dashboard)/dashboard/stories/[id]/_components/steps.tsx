"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Player } from "@remotion/player";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Music2,
  Pause,
  Play,
  Loader2,
  MessageCircle,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Bar, Eyebrow, Panel, PanelBody, PanelHeader, Segmented, Tone } from "@/components/ui/kit";
import { SaveVideoButton } from "@/components/save-video-button";
import { cn } from "@/lib/utils";
import { StoryComposition } from "@/remotion/Story";
import { FeedbackBar, type Ratings } from "./feedback";
import { VoicePreviewButton } from "../../_components/voice-picker";
import { parseScript, WORDS_PER_SEC, wordCount } from "../../_components/util";
import type { CaptionStyle } from "@/types/clip";
import {
  CAMERA_MOVES,
  DEFAULT_MUSIC_VOLUME,
  MUSIC_MOODS,
  STORY_DIMS,
  STORY_FPS,
  STORY_VIDEO_MODELS,
  STORY_VOICES,
  MOTION_MODEL_IDS,
  TALKING_MODEL,
  isTalking,
  shotSeconds,
  storyDurationInFrames,
  videoDurationFor,
  type CameraMove,
  type ItemStatus,
  type StoryCompositionProps,
  type StoryVideoModel,
} from "@/types/story";

type Story = NonNullable<FunctionReturnType<typeof api.stories.get>>;
type Shot = Story["shots"][number];
type Run = (fn: () => Promise<unknown>) => Promise<void>;
type StepProps = { story: Story; run: Run; ratings: Ratings };
type Entry = { id: string; name: string; look: string; voice?: string; refStatus: ItemStatus; refError?: string | null };

const field =
  "w-full rounded-[10px] bg-bg border border-line px-3 py-2 text-base sm:text-sm text-fg placeholder:text-faint focus:outline-none focus:border-line-strong";
const selectCls = "h-8 rounded-lg bg-bg border border-line px-2 text-base sm:text-xs text-muted min-w-0";
const note = "text-xs text-faint leading-relaxed";
const pad2 = (i: number) => String(i + 1).padStart(2, "0");
const cameraLabel = (id: string) => CAMERA_MOVES.find((c) => c.id === id)?.label ?? id;
const isBusy = (s: string | undefined | null) => s === "queued" || s === "working";

// Phase 2 helpers: estimated price of animating a shot with a model.
const usd = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const clipCost = (model: StoryVideoModel, audioSec: number | null | undefined) =>
  videoDurationFor(model, shotSeconds(audioSec)) * STORY_VIDEO_MODELS[model].perSec;
const hasVideo = (shot: { mode?: string; videoStatus?: string; videoUrl?: string | null }) =>
  shot.mode === "video" && shot.videoStatus === "ready" && !!shot.videoUrl;
const talks = (shot: { mode?: string; videoStatus?: string; videoUrl?: string | null; videoModel?: string | null }) =>
  hasVideo(shot) && isTalking(shot.videoModel);

// Text that saves when you leave the field; follows server updates while not focused.
function Editable({
  value,
  onSave,
  rows,
  placeholder,
  className,
  label,
}: {
  value: string;
  onSave: (v: string) => unknown;
  rows?: number;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);
  const common = {
    value: local,
    "aria-label": label,
    placeholder,
    onFocus: () => (focused.current = true),
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setLocal(e.target.value),
    onBlur: () => {
      focused.current = false;
      if (local !== value) onSave(local);
    },
    className: cn(field, className),
  };
  return rows ? <textarea rows={rows} {...common} /> : <input {...common} />;
}

function Working({ text }: { text: string }) {
  return (
    <Panel className="p-8 flex flex-col items-center gap-3 text-center">
      <Loader2 className="animate-spin text-accent" size={28} />
      <div className="text-fg">{text}</div>
      <div className={note}>You can leave this page; it keeps going in the background.</div>
    </Panel>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full border border-line-strong text-muted font-mono whitespace-nowrap">
      {children}
    </span>
  );
}

// Main column + 300px aside. The aside's first panel holds the step's primary
// action; on phones it's pinned above the bottom tab bar.
function StepLayout({
  main,
  primary,
  aside,
  asideRef,
}: {
  main: React.ReactNode;
  primary?: React.ReactNode;
  aside?: React.ReactNode;
  asideRef?: React.Ref<HTMLElement>;
}) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start min-w-0">
      <div className="min-w-0">{main}</div>
      <aside ref={asideRef} className="grid gap-3 min-w-0 lg:sticky lg:top-4">
        {primary && (
          <Panel
            className={cn(
              "max-md:fixed max-md:inset-x-0 max-md:z-30 max-md:bottom-[calc(60px+env(safe-area-inset-bottom,0px))]",
              "max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:bg-surface/95 max-md:backdrop-blur-md"
            )}
          >
            <div className="grid gap-2.5 p-4 max-md:gap-1.5 max-md:py-2.5 [&_button]:w-full max-md:[&_button]:h-11">{primary}</div>
          </Panel>
        )}
        {aside}
      </aside>
      {primary && <div aria-hidden className="h-28 md:hidden" />}
    </div>
  );
}

// ── 1. Script ──

export function ScriptStep({ story, run, ratings }: StepProps) {
  const updateScript = useMutation(api.stories.updateScript);
  const rewrite = useMutation(api.stories.rewriteScript);
  const confirm = useMutation(api.stories.confirmScript);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(story.script ?? "");
  const dirty = draft !== (story.script ?? "");
  useEffect(() => setDraft(story.script ?? ""), [story.script]);
  const parsed = useMemo(() => parseScript(draft), [draft]);

  if (story.busy.script) return <Working text="The writer is drafting your script…" />;
  if (!story.script) {
    return (
      <Panel className="p-6 grid gap-3 justify-items-start">
        <p className="text-muted">No script yet.</p>
        <Button onClick={() => run(() => rewrite({ storyId: story._id }))}>
          <Wand2 size={16} /> Write the script
        </Button>
      </Panel>
    );
  }

  const saveArgs = () => ({
    storyId: story._id,
    script: draft,
    hook: draft.match(/^HOOK:\s*(.*)$/m)?.[1],
    title: draft.match(/^TITLE:\s*(.*)$/m)?.[1],
  });

  return (
    <StepLayout
      main={
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>{editing ? "Editing script" : "Screenplay"}</Eyebrow>
            <Button size="sm" variant={editing ? "secondary" : "outline"} onClick={() => setEditing(!editing)}>
              <Pencil size={13} /> {editing ? "Done" : "Edit"}
            </Button>
          </div>
          {editing ? (
            <>
              <textarea
                aria-label="Script"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={cn(field, "font-mono text-[13px] leading-relaxed min-h-[50dvh] lg:min-h-[560px]")}
              />
              <div className="flex justify-between gap-3 text-xs text-faint font-mono">
                <span>{wordCount(draft)} words</span>
                <span>{dirty ? "Unsaved edits" : "Saved"}</span>
              </div>
            </>
          ) : (
            <div className="rounded-[12px] border border-line bg-surface px-4 py-4 sm:px-6 sm:py-5 grid gap-3.5 font-mono text-[13px] leading-[1.65] min-w-0">
              {(parsed.title || parsed.hook) && (
                <div className="text-xs text-faint grid gap-0.5 pb-3 border-b border-dashed border-line-strong">
                  {parsed.title && (
                    <span>
                      <b className="text-accent font-medium">TITLE</b> {parsed.title}
                    </span>
                  )}
                  {parsed.hook && (
                    <span>
                      <b className="text-accent font-medium">HOOK</b> {parsed.hook}
                    </span>
                  )}
                </div>
              )}
              {parsed.lines.map((l, i) => (
                <div key={i} className="grid sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-3.5 min-w-0">
                  <span
                    className={cn(
                      "text-[11px] uppercase tracking-[0.08em] pt-0.5 truncate",
                      l.narrator ? "text-faint" : "text-[#6fa8ff]"
                    )}
                  >
                    {l.who}
                  </span>
                  <p className="font-sans text-[15px] text-fg leading-[1.55] break-words">{l.text}</p>
                </div>
              ))}
              <div className="flex justify-between gap-3 text-xs text-faint pt-3 border-t border-dashed border-line-strong">
                <span>{parsed.words} words</span>
                <span>≈ {Math.round(parsed.words / WORDS_PER_SEC)}s of voiceover</span>
              </div>
            </div>
          )}
        </div>
      }
      primary={
        <>
          <Button
            onClick={() =>
              run(async () => {
                if (dirty) await updateScript(saveArgs());
                await confirm({ storyId: story._id });
              })
            }
          >
            Plan the shots <ArrowRight size={16} />
          </Button>
          {dirty && (
            <Button variant="outline" onClick={() => run(() => updateScript(saveArgs()))}>
              Save edits
            </Button>
          )}
          <span className={cn(note, "max-md:hidden")}>
            Lines are <code className="font-mono">NARRATOR:</code> or <code className="font-mono">NAME:</code>. The hook shows on
            screen and isn&apos;t spoken.
          </span>
        </>
      }
      aside={
        <>
          <Panel>
            <PanelHeader title="Rewrite" />
            <PanelBody className="grid gap-2.5">
              <textarea
                aria-label="Rewrite notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. darker ending, more dialogue, make it funnier"
                className={field}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  run(async () => {
                    await rewrite({ storyId: story._id, notes });
                    setNotes("");
                  })
                }
              >
                <RefreshCw size={13} /> Rewrite with notes
              </Button>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelBody>
              <FeedbackBar storyId={story._id} stage="script" ratings={ratings} label="How's this script?" />
            </PanelBody>
          </Panel>
        </>
      }
    />
  );
}

// ── 2. Plan ──

function ShotRow({ shot, index, story, run }: { shot: Shot; index: number; story: Story; run: Run }) {
  const updateShot = useMutation(api.stories.updateShot);
  const moveShot = useMutation(api.stories.moveShot);
  const deleteShot = useMutation(api.stories.deleteShot);
  const addShot = useMutation(api.stories.addShot);
  const [editing, setEditing] = useState(false);
  const bible = story.bible!;
  const save = (patch: Omit<Parameters<typeof updateShot>[0], "shotId">) => run(() => updateShot({ shotId: shot._id, ...patch }));
  const speaker = shot.speaker === "narrator" ? null : bible.characters.find((c) => c.id === shot.speaker)?.name;
  const dur = shot.audioSec ?? wordCount(shot.narration) / WORDS_PER_SEC;
  const iconBtn = "w-8 h-8 grid place-items-center rounded-lg text-faint hover:text-fg hover:bg-surface-3";
  const K = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] text-faint uppercase tracking-[0.08em] mb-0.5">{children}</div>
  );

  return (
    <li className={cn("rounded-[12px] border bg-surface px-3.5 py-3 grid gap-3 min-w-0", editing ? "border-line-strong" : "border-line")}>
      <div className="grid grid-cols-[28px_minmax(0,1fr)] sm:grid-cols-[34px_minmax(0,1fr)_minmax(0,1fr)_120px] gap-x-3.5 gap-y-2.5 items-start">
        <span className="font-mono text-xs text-faint pt-0.5">{pad2(index)}</span>
        <div className="min-w-0">
          <K>Spoken{speaker ? ` · ${speaker}` : ""}</K>
          <div className="text-sm leading-[1.45] text-fg break-words">
            {shot.narration || <i className="text-faint">No narration</i>}
          </div>
        </div>
        <div className="min-w-0 max-sm:col-start-2">
          <K>Picture</K>
          <div className="text-sm leading-[1.45] text-muted break-words">{shot.imagePrompt}</div>
        </div>
        <div className="max-sm:col-start-2 flex flex-wrap items-center gap-1.5 sm:grid sm:justify-items-start">
          <Tag>{cameraLabel(shot.camera)}</Tag>
          <Tag>{dur.toFixed(1)}s</Tag>
          <button
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg min-h-8 px-1"
          >
            <Pencil size={12} /> {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="grid gap-2 border-t border-line pt-3">
          <Editable label="Narration" value={shot.narration} rows={2} placeholder="Words spoken in this shot" onSave={(narration) => save({ narration })} />
          <Editable
            label="Picture description"
            value={shot.imagePrompt}
            rows={2}
            placeholder="What the picture shows"
            className="text-muted"
            onSave={(imagePrompt) => save({ imagePrompt })}
          />
          <div className="flex flex-wrap gap-2">
            <select aria-label="Speaker" value={shot.speaker} onChange={(e) => save({ speaker: e.target.value })} className={selectCls}>
              <option value="narrator">Narrator</option>
              {bible.characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Location"
              value={shot.location ?? ""}
              onChange={(e) => save({ location: e.target.value || null })}
              className={selectCls}
            >
              <option value="">No set location</option>
              {bible.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <select aria-label="Camera" value={shot.camera} onChange={(e) => save({ camera: e.target.value })} className={selectCls}>
              {CAMERA_MOVES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {bible.characters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {bible.characters.map((c) => {
                const on = shot.characters.includes(c.id);
                return (
                  <button
                    key={c.id}
                    aria-pressed={on}
                    onClick={() =>
                      save({ characters: on ? shot.characters.filter((x) => x !== c.id) : [...shot.characters, c.id] })
                    }
                    className={cn(
                      "text-xs px-2.5 min-h-8 rounded-full border transition",
                      on ? "border-fg bg-surface-3 text-fg" : "border-line-strong text-muted hover:text-fg"
                    )}
                  >
                    {on ? "✓ " : ""}
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-1">
            <button aria-label="Move up" onClick={() => run(() => moveShot({ shotId: shot._id, dir: -1 }))} className={iconBtn}>
              <ArrowUp size={15} />
            </button>
            <button aria-label="Move down" onClick={() => run(() => moveShot({ shotId: shot._id, dir: 1 }))} className={iconBtn}>
              <ArrowDown size={15} />
            </button>
            <button
              aria-label="Add shot after"
              onClick={() => run(() => addShot({ storyId: story._id, afterShotId: shot._id }))}
              className={iconBtn}
            >
              <Plus size={15} />
            </button>
            <button
              aria-label="Delete shot"
              onClick={() => run(() => deleteShot({ shotId: shot._id }))}
              className={cn(iconBtn, "hover:text-bad ml-auto")}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// Name / look / voice fields for a character or location.
function BibleFields({ story, kind, entry, run }: { story: Story; kind: "character" | "location"; entry: Entry; run: Run }) {
  const update = useMutation(api.stories.updateBibleEntry);
  return (
    <div className="grid gap-2">
      <Editable label="Name" value={entry.name} onSave={(name) => run(() => update({ storyId: story._id, kind, id: entry.id, name }))} />
      <Editable
        label="Look"
        value={entry.look}
        rows={3}
        className="text-muted"
        onSave={(look) => run(() => update({ storyId: story._id, kind, id: entry.id, look }))}
      />
      {kind === "character" && (
        <div className="flex items-center gap-2">
          <VoicePreviewButton voice={entry.voice ?? ""} />
          <select
            aria-label="Voice"
            value={entry.voice ?? ""}
            onChange={(e) => run(() => update({ storyId: story._id, kind, id: entry.id, voice: e.target.value }))}
            className={cn(selectCls, "flex-1")}
          >
            {STORY_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                Voice: {v.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function EntityRow({ story, kind, entry, run }: { story: Story; kind: "character" | "location"; entry: Entry; run: Run }) {
  const [editing, setEditing] = useState(false);
  const url = story.refUrls[`${kind}:${entry.id}`];
  return (
    <li className="py-2 border-t border-line first:border-t-0 grid gap-2">
      <div className="flex items-center gap-2.5 text-[13px] min-w-0">
        <span className="w-[34px] h-[34px] rounded-lg bg-surface-3 overflow-hidden flex-shrink-0 grid place-items-center text-xs text-faint">
          {url && entry.refStatus === "ready" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            entry.name.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-fg truncate">{entry.name}</div>
          <small className="block text-xs text-faint line-clamp-2">{entry.look}</small>
        </div>
        {kind === "character" && entry.voice && <VoicePreviewButton voice={entry.voice} />}
        <button
          aria-label={editing ? `Done editing ${entry.name}` : `Edit ${entry.name}`}
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
          className={cn(
            "w-8 h-8 grid place-items-center rounded-lg flex-shrink-0",
            editing ? "bg-surface-3 text-fg" : "text-faint hover:text-fg hover:bg-surface-3"
          )}
        >
          <Pencil size={13} />
        </button>
      </div>
      {editing && <BibleFields story={story} kind={kind} entry={entry} run={run} />}
    </li>
  );
}

export function PlanStep({ story, run, ratings }: StepProps) {
  const replan = useMutation(api.stories.replan);
  const confirm = useMutation(api.stories.confirmPlan);
  const addShot = useMutation(api.stories.addShot);
  if (story.busy.plan) return <Working text="The director is breaking your script into shots, characters and locations…" />;
  if (!story.bible) {
    return (
      <Panel className="p-6 grid gap-3 justify-items-start">
        <p className="text-muted">No plan yet.</p>
        <Button onClick={() => run(() => replan({ storyId: story._id }))}>
          <Clapperboard size={16} /> Plan the shots
        </Button>
      </Panel>
    );
  }
  const bible = story.bible;
  const refCount = bible.characters.length + bible.locations.length;
  const estSec = story.shots.reduce((s, x) => s + wordCount(x.narration) / WORDS_PER_SEC, 0);
  return (
    <StepLayout
      main={
        <ol className="grid gap-2">
          {story.shots.map((shot, i) => (
            <ShotRow key={shot._id} shot={shot} index={i} story={story} run={run} />
          ))}
          <li>
            <Button size="sm" variant="outline" onClick={() => run(() => addShot({ storyId: story._id }))}>
              <Plus size={14} /> Add shot
            </Button>
          </li>
        </ol>
      }
      primary={
        <>
          <Button onClick={() => run(() => confirm({ storyId: story._id }))}>
            Draw the cast ({refCount} images) <ArrowRight size={16} />
          </Button>
          <span className={note}>
            {story.shots.length} shots · ≈ {Math.round(estSec)}s total · ≈ ${(refCount * 0.04).toFixed(2)}
          </span>
        </>
      }
      aside={
        <>
          <Panel>
            <PanelBody className="grid gap-3">
              <FeedbackBar storyId={story._id} stage="plan" ratings={ratings} label="How's this plan?" />
              <Button size="sm" variant="outline" className="w-full" onClick={() => run(() => replan({ storyId: story._id }))}>
                <RefreshCw size={13} /> Re-plan from script
              </Button>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Characters" />
            <PanelBody className="py-1">
              {bible.characters.length === 0 ? (
                <p className={cn(note, "py-2")}>No recurring characters.</p>
              ) : (
                <ul>
                  {bible.characters.map((c) => (
                    <EntityRow key={c.id} story={story} kind="character" entry={c} run={run} />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
          {bible.locations.length > 0 && (
            <Panel>
              <PanelHeader title="Locations" />
              <PanelBody className="py-1">
                <ul>
                  {bible.locations.map((l) => (
                    <EntityRow key={l.id} story={story} kind="location" entry={l} run={run} />
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          )}
        </>
      }
    />
  );
}

// ── 3. Cast ──

function CastCard({ story, kind, entry, run }: { story: Story; kind: "character" | "location"; entry: Entry; run: Run }) {
  const redo = useMutation(api.stories.redoRef);
  const [editing, setEditing] = useState(false);
  const url = story.refUrls[`${kind}:${entry.id}`];
  const busy = isBusy(entry.refStatus);
  return (
    <li className="rounded-[12px] border border-line bg-surface overflow-hidden grid content-start min-w-0">
      <div className={cn("relative bg-surface-2", kind === "character" ? "aspect-square" : story.aspect === "9:16" ? "aspect-[3/4]" : "aspect-video")}>
        {url && entry.refStatus === "ready" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={entry.name} className="absolute inset-0 w-full h-full object-cover" />
        ) : entry.refStatus === "failed" ? (
          <div className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-bad">
            <span className="grid gap-1.5 justify-items-center">
              <AlertTriangle size={18} />
              {entry.refError ?? "Failed"}
            </span>
          </div>
        ) : null}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-bg/60 text-[13px] font-semibold text-accent">
            {entry.refStatus === "working" ? "Drawing…" : "Waiting…"}
          </div>
        )}
      </div>
      <div className="px-3.5 py-3 grid gap-2 min-w-0">
        <h4 className="text-[15px] font-semibold text-fg flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span className="truncate">{entry.name}</span>
          {entry.refStatus === "ready" ? (
            <Tone tone="ok">Approved</Tone>
          ) : busy ? (
            <Tone tone="warn">Drawing</Tone>
          ) : entry.refStatus === "failed" ? (
            <Tone tone="bad">Failed</Tone>
          ) : null}
        </h4>
        {kind === "location" && <Eyebrow className="-mt-1">Location</Eyebrow>}
        {!editing && <p className="text-[13px] text-muted line-clamp-3 break-words">{entry.look}</p>}
        {editing && <BibleFields story={story} kind={kind} entry={entry} run={run} />}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => redo({ storyId: story._id, kind, id: entry.id }))}>
            <RefreshCw size={12} /> Redraw
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>
    </li>
  );
}

export function CastStep({ story, run }: StepProps) {
  const confirm = useMutation(api.stories.confirmCast);
  const bible = story.bible!;
  const all = [...bible.characters, ...bible.locations];
  const ready = all.filter((x) => x.refStatus === "ready").length;
  const n = story.shots.length;
  return (
    <StepLayout
      main={
        <ul className="grid grid-cols-2 lg:grid-cols-3 gap-3.5">
          {bible.characters.map((c) => (
            <CastCard key={c.id} story={story} kind="character" entry={c} run={run} />
          ))}
          {bible.locations.map((l) => (
            <CastCard key={l.id} story={story} kind="location" entry={l} run={run} />
          ))}
        </ul>
      }
      primary={
        <>
          <Button disabled={ready < all.length} onClick={() => run(() => confirm({ storyId: story._id }))}>
            Make the storyboard <ArrowRight size={16} />
          </Button>
          {ready < all.length ? (
            <>
              <span className={note}>
                Drawing references: {ready} of {all.length} ready
              </span>
              <Bar value={(ready / Math.max(1, all.length)) * 100} />
            </>
          ) : (
            <span className={note}>
              Every shot reuses these faces so characters stay consistent. {n} pictures + voice ≈ ${(n * 0.05 + 0.02).toFixed(2)}.
            </span>
          )}
        </>
      }
    />
  );
}

// ── 4. Storyboard ──

const waveStyle: React.CSSProperties = {
  background: "repeating-linear-gradient(90deg, var(--color-muted) 0 2px, transparent 2px 4px)",
  opacity: 0.5,
  clipPath:
    "polygon(0 40%, 8% 10%, 16% 60%, 24% 20%, 32% 50%, 40% 0, 48% 45%, 56% 15%, 64% 70%, 72% 25%, 80% 55%, 88% 30%, 100% 50%, 100% 100%, 0 100%)",
};

function Frame({
  shot,
  index,
  story,
  run,
  selected,
  onSelect,
}: {
  shot: Shot;
  index: number;
  story: Story;
  run: Run;
  selected: boolean;
  onSelect: () => void;
}) {
  const redoShot = useMutation(api.stories.redoShot);
  const redoVoice = useMutation(api.stories.redoVoice);
  const busyStill = isBusy(shot.stillStatus);
  const busyVoice = isBusy(shot.audioStatus);
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <li
      onClick={onSelect}
      className={cn(
        "rounded-[12px] border bg-surface overflow-hidden grid content-start min-w-0 cursor-pointer transition",
        selected ? "border-fg" : "border-line hover:border-line-strong"
      )}
    >
      <button
        type="button"
        aria-label={`Select shot ${index + 1}`}
        aria-pressed={selected}
        className={cn("relative block w-full bg-surface-2", story.aspect === "9:16" ? "aspect-[3/4]" : "aspect-video")}
      >
        {hasVideo(shot) ? (
          <video
            key={shot.videoUrl!}
            src={shot.videoUrl!}
            poster={shot.stillUrl ?? undefined}
            muted
            loop
            playsInline
            autoPlay={selected}
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : shot.stillUrl && shot.stillStatus === "ready" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.stillUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : shot.stillStatus === "failed" ? (
          <span className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-bad">
            <span className="grid gap-1.5 justify-items-center">
              <AlertTriangle size={18} />
              <span className="line-clamp-3">{shot.stillError ?? "Picture failed"}</span>
            </span>
          </span>
        ) : (
          !busyStill && (
            <span className="absolute inset-0 grid place-items-center text-line-strong">
              <ImageIcon size={20} />
            </span>
          )
        )}
        {busyStill && (
          <span className="absolute inset-0 grid place-items-center bg-bg/60 text-[13px] font-semibold text-accent">
            {shot.stillStatus === "working" ? "Drawing…" : "Waiting…"}
          </span>
        )}
        {!busyStill && isBusy(shot.videoStatus) && (
          <span className="absolute inset-0 grid place-items-center bg-bg/55 text-[13px] font-semibold text-accent">
            <span className="grid justify-items-center gap-1">
              <Loader2 size={16} className="animate-spin" />
              {isTalking(shot.videoModel)
                ? shot.videoStatus === "working"
                  ? "Making it talk…"
                  : "Waiting to talk…"
                : shot.videoStatus === "working"
                  ? "Animating…"
                  : "Waiting to animate…"}
            </span>
          </span>
        )}
        {hasVideo(shot) && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 text-[10px] font-mono text-white bg-black/60 px-1.5 rounded">
            {talks(shot) ? (
              <>
                <MessageCircle size={10} /> talking
              </>
            ) : (
              <>
                <Film size={10} /> video
              </>
            )}
          </span>
        )}
        <span className="absolute top-2 left-2 text-[11px] font-mono text-white bg-black/50 px-1.5 rounded">{pad2(index)}</span>
        <span className="absolute top-2 right-2 text-[10px] font-mono text-white bg-black/50 px-1.5 rounded lowercase">
          {cameraLabel(shot.camera)}
        </span>
        {shot.continuity && !shot.continuity.ok && !busyStill && (
          <span
            title={shot.continuity.issue ?? "A character may not match"}
            className="absolute bottom-2 left-2 text-[11px] font-semibold px-1.5 rounded bg-accent text-black"
          >
            ⚠ check
          </span>
        )}
      </button>
      <div className="px-3 py-2.5 grid gap-1.5 min-w-0">
        <p className="text-[13px] leading-[1.4] text-fg line-clamp-2 break-words">{shot.narration}</p>
        <div className="flex items-center gap-2 text-[11px] font-mono text-faint min-h-8">
          {shot.audioStatus === "ready" ? (
            <>
              <span className="flex-1 h-3.5" style={waveStyle} />
              {(shot.audioSec ?? 0).toFixed(1)}s
            </>
          ) : shot.audioStatus === "failed" ? (
            <>
              <span className="text-bad truncate" title={shot.audioError ?? undefined}>
                Voice failed ·
              </span>
              <button onClick={stop(() => run(() => redoVoice({ shotId: shot._id })))} className="text-fg underline min-h-8">
                Retry
              </button>
            </>
          ) : busyVoice ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Recording voice…
            </>
          ) : (
            <>
              <Mic size={11} /> No voice yet
            </>
          )}
        </div>
        {shot.videoStatus === "failed" && (
          <span className="text-[11px] text-bad line-clamp-2 -mt-1" title={shot.videoError ?? undefined}>
            Video failed: {shot.videoError ?? "try again"}
          </span>
        )}
        {shot.stillStatus === "failed" && (
          <button
            onClick={stop(() => run(() => redoShot({ shotId: shot._id, imagePrompt: shot.imagePrompt })))}
            className="text-[11px] font-mono text-fg underline justify-self-start min-h-8 -mt-1.5"
          >
            Retry picture
          </button>
        )}
      </div>
    </li>
  );
}

// Phase 2: still ↔ AI video for the selected shot.
function MotionPanel({ shot, story, run, ratings }: { shot: Shot; story: Story; run: Run; ratings: Ratings }) {
  const setShotMode = useMutation(api.stories.setShotMode);
  const makeVideos = useMutation(api.stories.makeVideos);
  const redoVideo = useMutation(api.stories.redoVideo);
  const [motion, setMotion] = useState(shot.motionPrompt ?? "");
  useEffect(() => setMotion(shot.motionPrompt ?? ""), [shot._id, shot.motionPrompt]);
  // Still / Video / Talking. "Talking" is a video made with the talking model.
  const stored: "still" | "video" | "talk" = shot.mode !== "video" ? "still" : isTalking(shot.videoModel) ? "talk" : "video";
  const [pick, setPick] = useState<"still" | "video" | "talk" | null>(null);
  useEffect(() => setPick(null), [shot._id]);
  const view = pick ?? stored;
  const motionModel = (shot.videoModel && !isTalking(shot.videoModel) ? shot.videoModel : story.videoModel ?? "kling-3-std") as StoryVideoModel;
  const model = view === "talk" ? TALKING_MODEL : motionModel;
  const sameModel = shot.videoModel === model;
  const busy = isBusy(shot.videoStatus);
  const ready = shot.stillStatus === "ready" && shot.audioStatus === "ready";
  const cost = clipCost(model, shot.audioSec);
  const narrator = shot.speaker === "narrator";
  const doneHere = sameModel && shot.videoStatus === "ready";
  return (
    <div className="grid gap-2 border-t border-line pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Motion</Eyebrow>
        <Segmented
          size="sm"
          label="Shot type"
          value={view}
          onChange={(m) => {
            const next = m as "still" | "video" | "talk";
            setPick(next);
            if (next === "still" ? stored !== "still" : stored === "still") {
              run(() => setShotMode({ shotId: shot._id, mode: next === "still" ? "still" : "video" }));
            }
          }}
          options={[
            { value: "still", label: "Still" },
            { value: "video", label: "Video" },
            { value: "talk", label: "Talking", title: "The character says this line with matching lips" },
          ]}
        />
      </div>
      {view !== "still" && (
        <>
          <textarea
            aria-label={view === "talk" ? "How they talk" : "Motion description"}
            value={motion}
            onChange={(e) => setMotion(e.target.value)}
            rows={view === "talk" ? 2 : 3}
            placeholder={
              view === "talk"
                ? "Optional: how they say it, e.g. smiles warmly, leans in, worried look"
                : "What moves: e.g. Oga trots forward and glances back; slow push in"
            }
            className={field}
          />
          {view === "talk" && narrator && (
            <p className="text-xs text-accent">
              This line is the narrator&apos;s. Whoever is in the picture will say it. Talking works best when a character speaks to camera.
            </p>
          )}
          {shot.videoStatus === "failed" && sameModel && shot.videoError && <p className="text-xs text-bad">{shot.videoError}</p>}
          <Button
            size="sm"
            disabled={busy || !ready}
            onClick={() =>
              run(() =>
                !sameModel || shot.videoStatus === "ready" || shot.videoStatus === "failed" || motion !== (shot.motionPrompt ?? "")
                  ? redoVideo({ shotId: shot._id, motionPrompt: motion, model })
                  : makeVideos({ storyId: story._id, shotIds: [shot._id], model })
              )
            }
          >
            {busy ? (
              <>
                <Loader2 size={13} className="animate-spin" /> {isTalking(shot.videoModel) ? "Making it talk…" : "Animating…"}
              </>
            ) : view === "talk" ? (
              <>
                <MessageCircle size={13} /> {doneHere ? "Redo talking" : "Make it talk"} · ≈ {usd(cost)}
              </>
            ) : (
              <>
                <Film size={13} /> {doneHere ? "Redo video" : "Animate this shot"} · ≈ {usd(cost)}
              </>
            )}
          </Button>
          <span className={note}>
            {STORY_VIDEO_MODELS[model].label} · {videoDurationFor(model, shotSeconds(shot.audioSec))}s clip · about 1–3 min.
            {!ready && " Needs the picture and voice first."}
            {ready && shot.videoStatus === "ready" && !sameModel && " Replaces the current clip."}
          </span>
          {shot.videoStatus === "ready" && (
            <FeedbackBar key={`motion-${shot._id}`} storyId={story._id} stage="motion" targetId={shot._id} ratings={ratings} label="Motion" compact />
          )}
        </>
      )}
    </div>
  );
}

function SelectedShot({ shot, index, story, run, ratings }: { shot: Shot; index: number; story: Story; run: Run; ratings: Ratings }) {
  const redoShot = useMutation(api.stories.redoShot);
  const redoVoice = useMutation(api.stories.redoVoice);
  const updateShot = useMutation(api.stories.updateShot);
  const [prompt, setPrompt] = useState(shot.imagePrompt);
  useEffect(() => setPrompt(shot.imagePrompt), [shot._id, shot.imagePrompt]);
  const busyStill = isBusy(shot.stillStatus);
  const busyVoice = isBusy(shot.audioStatus);
  return (
    <Panel>
      <PanelHeader title={`Selected: shot ${pad2(index)}`} />
      <PanelBody className="grid gap-2.5">
        {shot.continuity && !shot.continuity.ok && shot.continuity.issue && (
          <p className="text-xs text-accent">⚠ {shot.continuity.issue}</p>
        )}
        <textarea
          aria-label="Picture description"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className={field}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={busyStill} onClick={() => run(() => redoShot({ shotId: shot._id, imagePrompt: prompt }))}>
            <RefreshCw size={12} /> Redraw picture
          </Button>
          <Button size="sm" variant="outline" disabled={busyVoice} onClick={() => run(() => redoVoice({ shotId: shot._id }))}>
            <Mic size={12} /> Re-record voice
          </Button>
        </div>
        <Segmented
          size="sm"
          label="Camera"
          value={shot.camera}
          onChange={(camera) => run(() => updateShot({ shotId: shot._id, camera }))}
          options={CAMERA_MOVES.map((c) => ({ value: c.id as string, label: c.label }))}
        />
        {shot.audioUrl && shot.audioStatus === "ready" && (
          <audio key={shot.audioUrl} src={shot.audioUrl} controls preload="none" className="w-full h-8" />
        )}
        <MotionPanel shot={shot} story={story} run={run} ratings={ratings} />
        {(shot.stillStatus === "ready" || shot.audioStatus === "ready") && (
          <div className="grid gap-1 border-t border-line pt-2">
            {shot.stillStatus === "ready" && !busyStill && (
              <FeedbackBar key={`still-${shot._id}`} storyId={story._id} stage="still" targetId={shot._id} ratings={ratings} label="Picture" compact />
            )}
            {shot.audioStatus === "ready" && !busyVoice && (
              <FeedbackBar key={`voice-${shot._id}`} storyId={story._id} stage="voice" targetId={shot._id} ratings={ratings} label="Voice" compact />
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

export function BoardStep({ story, run, ratings }: StepProps) {
  const goToStep = useMutation(api.stories.goToStep);
  const makeVideos = useMutation(api.stories.makeVideos);
  const setVideoModel = useMutation(api.stories.setVideoModel);
  const shots = story.shots;
  const model = (story.videoModel ?? "kling-3-std") as StoryVideoModel;
  const animatable = shots.filter(
    (s) =>
      s.stillStatus === "ready" &&
      s.audioStatus === "ready" &&
      !isBusy(s.videoStatus) &&
      !(s.videoStatus === "ready" && s.videoModel === model) &&
      !talks(s)
  );
  // Character lines (not the narrator) that could talk on screen.
  const talkable = shots.filter(
    (s) => s.speaker !== "narrator" && s.stillStatus === "ready" && s.audioStatus === "ready" && !isBusy(s.videoStatus) && !talks(s)
  );
  const talkCost = talkable.reduce((sum, s) => sum + clipCost(TALKING_MODEL, s.audioSec), 0);
  const animateCost = animatable.reduce((sum, s) => sum + clipCost(model, s.audioSec), 0);
  const animating = shots.filter((s) => isBusy(s.videoStatus)).length;
  const videos = shots.filter((s) => hasVideo(s)).length;
  const [selId, setSelId] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const ready = shots.filter((s) => s.stillStatus === "ready" && s.audioStatus === "ready").length;
  const drawing = shots.filter((s) => isBusy(s.stillStatus) || isBusy(s.audioStatus)).length;
  const failed = shots.filter((s) => s.stillStatus === "failed" || s.audioStatus === "failed").length;
  const done = shots.length > 0 && ready === shots.length;
  const warnings = shots.filter((s) => s.continuity && !s.continuity.ok).length;
  const selIdx = Math.max(
    0,
    shots.findIndex((s) => s._id === selId) >= 0
      ? shots.findIndex((s) => s._id === selId)
      : shots.findIndex((s) => s.stillStatus === "failed" || s.audioStatus === "failed")
  );
  const selected = shots[selIdx];

  const select = (id: string) => {
    setSelId(id);
    // Single-column layouts: bring the selected-shot panel into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => asideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  return (
    <StepLayout
      asideRef={asideRef}
      main={
        <ul
          className={cn(
            "grid gap-3",
            story.aspect === "9:16" ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4" : "grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3"
          )}
        >
          {shots.map((s, i) => (
            <Frame key={s._id} shot={s} index={i} story={story} run={run} selected={i === selIdx} onSelect={() => select(s._id)} />
          ))}
        </ul>
      }
      primary={
        <>
          <Button disabled={!done || animating > 0} onClick={() => run(() => goToStep({ storyId: story._id, step: "export" }))}>
            Preview & export <ArrowRight size={16} />
          </Button>
          <span className={note}>
            {ready} of {shots.length} shots ready
            {drawing > 0 && ` · ${drawing} in progress`}
            {failed > 0 && ` · ${failed} failed`}
            {warnings > 0 && <span className="text-accent max-md:hidden"> · {warnings} flagged ⚠</span>}
          </span>
          {!done && <Bar value={(ready / Math.max(1, shots.length)) * 100} />}
          <div className="grid gap-2 border-t border-line pt-2.5 max-md:hidden">
            <Eyebrow>Make characters move</Eyebrow>
            <Segmented
              size="sm"
              label="Video model"
              value={model}
              onChange={(m) => run(() => setVideoModel({ storyId: story._id, model: m }))}
              options={MOTION_MODEL_IDS.map((id) => ({ value: id, label: STORY_VIDEO_MODELS[id].label, title: STORY_VIDEO_MODELS[id].note }))}
            />
            <Button
              variant="outline"
              disabled={animatable.length === 0}
              onClick={() =>
                run(async () => {
                  if (!window.confirm(`Animate ${animatable.length} shot${animatable.length > 1 ? "s" : ""} with ${STORY_VIDEO_MODELS[model].label} for about ${usd(animateCost)}?`)) return;
                  await makeVideos({ storyId: story._id, model });
                })
              }
            >
              <Film size={14} /> Animate {animatable.length || ""} shot{animatable.length === 1 ? "" : "s"}
              {animatable.length > 0 && ` · ≈ ${usd(animateCost)}`}
            </Button>
            {talkable.length > 0 && (
              <Button
                variant="outline"
                onClick={() =>
                  run(async () => {
                    if (
                      !window.confirm(
                        `Make ${talkable.length} character line${talkable.length > 1 ? "s" : ""} talk (lips match the voice) for about ${usd(talkCost)}?`
                      )
                    )
                      return;
                    await makeVideos({ storyId: story._id, model: TALKING_MODEL, shotIds: talkable.map((s) => s._id) });
                  })
                }
              >
                <MessageCircle size={14} /> Make {talkable.length} character line{talkable.length === 1 ? "" : "s"} talk · ≈ {usd(talkCost)}
              </Button>
            )}
            <span className={note}>
              {videos} of {shots.length} shots are video
              {shots.some(talks) && ` (${shots.filter(talks).length} talking)`}
              {animating > 0 && ` · ${animating} in progress`}. Animate skips talking shots. Or pick single shots in the panel below.
            </span>
          </div>
        </>
      }
      aside={selected && <SelectedShot shot={selected} index={selIdx} story={story} run={run} ratings={ratings} />}
    />
  );
}

// ── 5. Preview & export ──

const CAPTIONS: { value: CaptionStyle; label: string }[] = [
  { value: "bold", label: "Bold" },
  { value: "karaoke", label: "Karaoke" },
  { value: "clean", label: "Clean" },
  { value: "none", label: "Off" },
];

function MusicPicker({ story, run }: { story: Story; run: Run }) {
  const library = useQuery(api.stories.musicLibrary);
  const setMusic = useMutation(api.stories.setMusic);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (id: string, url: string) => {
    audio.current ??= new Audio();
    if (playing === id) {
      audio.current.pause();
      setPlaying(null);
      return;
    }
    audio.current.src = url;
    audio.current.volume = 0.6;
    audio.current.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
    audio.current.onended = () => setPlaying(null);
  };
  const current = story.musicTrack ?? null;
  const volume = story.musicVolume ?? DEFAULT_MUSIC_VOLUME;
  return (
    <div className="grid gap-2">
      <Eyebrow>Background music</Eyebrow>
      <select
        aria-label="Background music"
        value={current ?? ""}
        onChange={(e) => run(() => setMusic({ storyId: story._id, track: e.target.value || null }))}
        className="h-10 rounded-lg border border-line-strong bg-bg px-3 text-base sm:text-sm text-fg"
      >
        <option value="">No music</option>
        {MUSIC_MOODS.map((mood) => (
          <optgroup key={mood} label={mood[0].toUpperCase() + mood.slice(1)}>
            {(library ?? [])
              .filter((m) => m.mood === mood)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {current && (
        <div className="flex flex-wrap items-center gap-2">
          {(() => {
            const t = library?.find((m) => m.id === current);
            return t ? (
              <Button size="sm" variant="outline" onClick={() => toggle(t.id, t.url)}>
                {playing === t.id ? <Pause size={12} /> : <Play size={12} />} {playing === t.id ? "Stop" : "Listen"}
              </Button>
            ) : null;
          })()}
          <Segmented
            size="sm"
            label="Music volume"
            value={volume <= 0.08 ? "quiet" : volume >= 0.2 ? "loud" : "normal"}
            onChange={(v) => run(() => setMusic({ storyId: story._id, track: current, volume: v === "quiet" ? 0.07 : v === "loud" ? 0.22 : 0.12 }))}
            options={[
              { value: "quiet", label: "Quiet" },
              { value: "normal", label: "Normal" },
              { value: "loud", label: "Louder" },
            ]}
          />
        </div>
      )}
      <span className={note}>
        <Music2 size={11} className="inline -mt-0.5" /> Public-domain recordings, free to use anywhere.
      </span>
    </div>
  );
}

export function ExportStep({ story, run, ratings }: StepProps) {
  const setCaptionStyle = useMutation(api.stories.setCaptionStyle);
  const exportStory = useMutation(api.stories.exportStory);
  const updateScript = useMutation(api.stories.updateScript);
  const captionStyle = (story.captionStyle ?? "bold") as CaptionStyle;

  const inputProps: StoryCompositionProps = useMemo(
    () => ({
      shots: story.shots.map((s) => ({
        imageUrl: s.stillUrl ?? "",
        videoUrl: hasVideo(s) ? s.videoUrl : null,
        videoSec: s.videoSec ?? null,
        lipSync: talks(s),
        audioUrl: s.audioUrl,
        durationSec: shotSeconds(s.audioSec),
        camera: s.camera as CameraMove,
        words: s.words ?? [],
      })),
      aspect: story.aspect,
      captionStyle,
      hook: story.hook || null,
      musicUrl: story.musicUrl ?? null,
      musicVolume: story.musicVolume ?? DEFAULT_MUSIC_VOLUME,
    }),
    [story.shots, story.aspect, captionStyle, story.hook, story.musicUrl, story.musicVolume]
  );
  const dims = STORY_DIMS[story.aspect];
  const frames = storyDurationInFrames(inputProps);
  const rendering = story.renderStatus === "queued" || story.renderStatus === "rendering";
  const isDone = story.renderStatus === "done";
  const vertical = story.aspect === "9:16";

  return (
    <div className={cn("grid gap-6 items-start min-w-0", vertical ? "md:grid-cols-[minmax(0,340px)_1fr]" : "lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className={cn("rounded-[12px] overflow-hidden border border-line bg-black w-full", vertical && "max-w-[340px] max-md:mx-auto")}>
        <Player
          component={StoryComposition}
          inputProps={inputProps}
          durationInFrames={frames}
          fps={STORY_FPS}
          compositionWidth={dims.width}
          compositionHeight={dims.height}
          controls
          acknowledgeRemotionLicense
          style={{ width: "100%", aspectRatio: vertical ? "9 / 16" : "16 / 9" }}
        />
      </div>
      <div className="grid gap-4 min-w-0">
        <div className="text-sm text-muted tabular">
          {(frames / STORY_FPS).toFixed(1)}s · {story.shots.length} shots
        </div>
        <div className="grid gap-2">
          <Eyebrow>Captions</Eyebrow>
          <Segmented
            label="Captions"
            value={captionStyle}
            options={CAPTIONS}
            onChange={(c) => run(() => setCaptionStyle({ storyId: story._id, captionStyle: c }))}
          />
        </div>
        <div className="grid gap-2">
          <Eyebrow>Hook on screen</Eyebrow>
          <Editable
            label="Hook"
            value={story.hook ?? ""}
            placeholder="No hook"
            onSave={(hook) => run(() => updateScript({ storyId: story._id, script: story.script ?? "", hook }))}
          />
          <span className={note}>Shows for the first 2.6 s. Leave empty for none.</span>
        </div>
        <MusicPicker story={story} run={run} />

        {rendering && (
          <div className="grid gap-2 p-3.5 rounded-[10px] border border-line bg-bg">
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="text-accent">
                {story.renderStatus === "queued" ? "Waiting for the render server…" : "Rendering on our server…"}
              </span>
              <span className="font-mono tabular">{story.renderProgress ?? 0}%</span>
            </div>
            <Bar value={story.renderProgress ?? 0} />
            <span className={note}>You can leave this page.</span>
          </div>
        )}
        {story.renderStatus === "failed" && <p className="text-xs text-bad">{story.renderError ?? "Export failed"}</p>}

        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
          {isDone && story.downloadUrl && (
            <SaveVideoButton downloadUrl={story.downloadUrl} fileName={`${story.title}.mp4`} label={`Download MP4 · ${story.aspect}`} size="default" variant="default" />
          )}
          <Button
            variant={isDone ? "outline" : "default"}
            disabled={rendering}
            onClick={() => run(() => exportStory({ storyId: story._id }))}
          >
            {rendering ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {story.renderStatus === "queued" ? "Export queued" : `Exporting ${story.renderProgress ?? 0}%`}
              </>
            ) : isDone ? (
              "Re-export MP4"
            ) : (
              "Export MP4"
            )}
          </Button>
        </div>

        {isDone && (
          <Panel>
            <PanelBody className="grid gap-2">
              <FeedbackBar storyId={story._id} stage="video" ratings={ratings} label="How did the video turn out?" />
              <p className="text-[11px] text-faint">Your ratings teach the AI your taste for the next story.</p>
            </PanelBody>
          </Panel>
        )}
      </div>
    </div>
  );
}
