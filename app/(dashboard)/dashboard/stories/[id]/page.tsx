"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft, Check, Layers, Loader2, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Bar } from "@/components/ui/kit";
import { cn } from "@/lib/utils";
import { STORY_STEPS, type StoryStep } from "@/types/story";
import { errText, fmtLength, parseScript, styleLabel, voiceName } from "../_components/util";
import { BoardStep, CastStep, ExportStep, PlanStep, ScriptStep } from "./_components/steps";

export default function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const storyId = id as Id<"stories">;
  const router = useRouter();
  const story = useQuery(api.stories.get, { storyId });
  const ratings = useQuery(api.storyFeedback.forStory, { storyId }) ?? {};
  const goToStep = useMutation(api.stories.goToStep);
  const remove = useMutation(api.stories.remove);
  const [error, setError] = useState<string | null>(null);

  if (story === undefined) return <Loader2 className="animate-spin text-faint" />;
  if (story === null) {
    return (
      <div className="text-muted">
        Story not found. <Link href="/dashboard/stories" className="underline">Back to stories</Link>
      </div>
    );
  }

  // Steps you can open: everything up to the furthest step with data.
  const hasPlan = !!story.bible && story.shots.length > 0;
  const boardStarted = story.shots.some((s) => s.stillStatus !== "none" || s.audioStatus !== "none");
  const n = story.shots.length;
  const shotsReady = story.shots.filter((s) => s.stillStatus === "ready" && s.audioStatus === "ready").length;
  const allReady = n > 0 && shotsReady === n;
  const reachable: Record<StoryStep, boolean> = {
    script: true,
    plan: hasPlan || story.step === "plan",
    cast: hasPlan && (story.step === "cast" || story.step === "board" || story.step === "export" || boardStarted),
    board: boardStarted || story.step === "board" || story.step === "export",
    export: allReady || story.step === "export",
  };
  const currentIdx = STORY_STEPS.findIndex((s) => s.id === story.step);

  const chars = story.bible?.characters.length ?? 0;
  const refs = chars + (story.bible?.locations.length ?? 0);
  const summary: Record<StoryStep, string> = {
    script: story.script ? `${parseScript(story.script).words} words` : story.busy.script ? "Writing…" : "Not written",
    plan: hasPlan ? `${n} shots` : story.busy.plan ? "Planning…" : "After script",
    cast: hasPlan ? `${chars} character${chars === 1 ? "" : "s"}` : "After plan",
    board: boardStarted ? `${shotsReady} of ${n} ready` : "After cast",
    export:
      story.renderStatus === "done"
        ? "Exported"
        : story.renderStatus === "queued" || story.renderStatus === "rendering"
          ? `Rendering ${story.renderProgress ?? 0}%`
          : story.renderStatus === "failed"
            ? "Export failed"
            : reachable.export
              ? "Ready to export"
              : "After storyboard",
  };

  // Rough budget: pictures ≈ $0.04, voice ≈ $0.01 per shot, plus references.
  const estimate = hasPlan ? refs * 0.04 + n * 0.05 + 0.02 : (story.targetSec / 60) * 0.75;
  const budget = Math.max(estimate, story.costUsd);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="max-w-6xl mx-auto grid gap-5 min-w-0">
      <div className="grid gap-3.5 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard/stories" className="text-sm text-faint hover:text-fg inline-flex items-center gap-1.5 min-h-8">
            <ArrowLeft size={14} /> Stories
          </Link>
          <button
            onClick={() =>
              run(async () => {
                if (!window.confirm("Delete this story and all its pictures and audio?")) return;
                await remove({ storyId });
                router.push("/dashboard/stories");
              })
            }
            className="inline-flex items-center gap-1.5 text-xs text-faint hover:text-bad min-h-8 px-1"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg break-words">{story.title}</h1>
            <p className="text-[13px] text-faint mt-1">
              {story.aspect} · {fmtLength(story.targetSec)} · {styleLabel(story.style)} · narrated by {voiceName(story.narratorVoice)}
            </p>
            <SeriesLine story={story} run={run} />
          </div>
          <div className="grid gap-1.5 min-w-[200px] max-sm:w-full">
            <div className="flex justify-between text-xs text-faint">
              <span>Spent so far</span>
              <span className="font-mono tabular">
                <b className="text-fg">${story.costUsd.toFixed(2)}</b> of ≈ ${budget.toFixed(2)}
              </span>
            </div>
            <Bar value={(story.costUsd / budget) * 100} />
          </div>
        </div>

        <nav
          className="grid grid-cols-5 rounded-[12px] border border-line bg-surface overflow-hidden"
          aria-label="Story steps"
        >
          {STORY_STEPS.map((s, i) => {
            const active = s.id === story.step;
            const done = i < currentIdx || (s.id === "export" && story.renderStatus === "done");
            const locked = !reachable[s.id];
            return (
              <button
                key={s.id}
                disabled={locked}
                aria-current={active ? "step" : undefined}
                onClick={() => !active && run(() => goToStep({ storyId, step: s.id }))}
                className={cn(
                  "relative flex items-center gap-2.5 px-3.5 py-3 text-left min-w-0 border-l border-line first:border-l-0 transition",
                  "max-sm:flex-col max-sm:gap-1 max-sm:px-1 max-sm:py-2.5 max-sm:text-center",
                  active ? "bg-surface-2" : !locked && "hover:bg-surface-2/60",
                  locked && "opacity-45 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "w-6 h-6 rounded-full border grid place-items-center text-xs font-mono flex-shrink-0",
                    active
                      ? "bg-fg text-bg border-fg"
                      : done
                        ? "bg-ok/12 border-ok/40 text-ok"
                        : "border-line-strong text-faint"
                  )}
                >
                  {done && !active ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0 max-sm:w-full">
                  <span className={cn("block text-sm font-semibold max-sm:text-[11px] truncate", active ? "text-fg" : "text-muted")}>
                    {s.label}
                  </span>
                  <small className="block text-[11px] font-medium text-faint truncate max-sm:hidden">{summary[s.id]}</small>
                </span>
                {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-fg" />}
              </button>
            );
          })}
        </nav>
      </div>

      {(error || story.error) && (
        <div className="rounded-[10px] border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">{error || story.error}</div>
      )}

      {story.step === "script" && <ScriptStep story={story} run={run} ratings={ratings} />}
      {story.step === "plan" && <PlanStep story={story} run={run} ratings={ratings} />}
      {story.step === "cast" && <CastStep story={story} run={run} ratings={ratings} />}
      {story.step === "board" && <BoardStep story={story} run={run} ratings={ratings} />}
      {story.step === "export" && <ExportStep story={story} run={run} ratings={ratings} />}
    </div>
  );
}

// Phase 3a: "Episode of …" or "Save cast as a series".
function SeriesLine({
  story,
  run,
}: {
  story: NonNullable<FunctionReturnType<typeof api.stories.get>>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const saveSeries = useAction(api.seriesNode.saveFromStory);
  const [saving, setSaving] = useState(false);
  if (story.seriesTitle) {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-accent">
        <Layers size={12} /> Episode of {story.seriesTitle}
      </p>
    );
  }
  const refs = [...(story.bible?.characters ?? []), ...(story.bible?.locations ?? [])];
  if (refs.length === 0 || refs.some((x) => x.refStatus !== "ready")) return null;
  return (
    <button
      disabled={saving}
      onClick={() =>
        run(async () => {
          const title = window.prompt("Name this series (the cast and style will be reused for new episodes):", story.title);
          if (title === null) return;
          setSaving(true);
          try {
            await saveSeries({ storyId: story._id, title });
          } finally {
            setSaving(false);
          }
        })
      }
      className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 text-xs text-muted hover:text-fg disabled:opacity-50"
    >
      {saving ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />} Save cast as a series
    </button>
  );
}
