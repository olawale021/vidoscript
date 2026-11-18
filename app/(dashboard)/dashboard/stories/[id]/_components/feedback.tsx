"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { FEEDBACK_REASONS, type FeedbackStage } from "@/types/story";

export type Ratings = Record<string, { rating: number; reasons: string[]; note: string | null }>;

// 👍 / 👎, then reason chips and an optional note. Every change is saved and
// fed into the AI's future prompts (convex/storyFeedback.ts).
export function FeedbackBar({
  storyId,
  stage,
  targetId,
  ratings,
  label,
  compact,
}: {
  storyId: Id<"stories">;
  stage: FeedbackStage;
  targetId?: string;
  ratings: Ratings;
  label?: string;
  compact?: boolean;
}) {
  const rate = useMutation(api.storyFeedback.rate);
  const current = ratings[`${stage}:${targetId ?? ""}`];
  const [rating, setRating] = useState(current?.rating ?? 0);
  const [reasons, setReasons] = useState<string[]>(current?.reasons ?? []);
  const [note, setNote] = useState(current?.note ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setRating(current?.rating ?? 0);
    setReasons(current?.reasons ?? []);
    setNote(current?.note ?? "");
  }, [current?.rating, current?.reasons, current?.note]);

  const save = (next: { rating: number; reasons: string[]; note: string }) =>
    rate({ storyId, stage, targetId, rating: next.rating, reasons: next.reasons, note: next.note || undefined }).catch(() => {});

  const tap = (r: 1 | -1) => {
    const nextRating = rating === r ? 0 : r;
    // Reasons belong to one side; switching sides clears them.
    const nextReasons = nextRating === rating ? reasons : [];
    setRating(nextRating);
    setReasons(nextReasons);
    setOpen(nextRating !== 0);
    save({ rating: nextRating, reasons: nextReasons, note: nextRating === 0 ? "" : note });
    if (nextRating === 0) setNote("");
  };

  const toggleReason = (reason: string) => {
    const next = reasons.includes(reason) ? reasons.filter((x) => x !== reason) : [...reasons, reason];
    setReasons(next);
    save({ rating, reasons: next, note });
  };

  const options = rating > 0 ? FEEDBACK_REASONS[stage].up : rating < 0 ? FEEDBACK_REASONS[stage].down : [];
  const size = compact ? 14 : 16;
  const btn = (on: boolean, tone: "up" | "down") =>
    cn(
      "rounded-md transition flex items-center justify-center",
      compact ? "w-8 h-8" : "w-9 h-9",
      on
        ? tone === "up"
          ? "bg-ok/12 text-ok"
          : "bg-bad/14 text-bad"
        : "text-faint hover:text-fg hover:bg-surface-3"
    );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {label && <span className={cn("text-muted mr-1", compact ? "text-[11px]" : "text-sm")}>{label}</span>}
        <button aria-label="Good" aria-pressed={rating > 0} onClick={() => tap(1)} className={btn(rating > 0, "up")}>
          <ThumbsUp size={size} />
        </button>
        <button aria-label="Not good" aria-pressed={rating < 0} onClick={() => tap(-1)} className={btn(rating < 0, "down")}>
          <ThumbsDown size={size} />
        </button>
        {rating !== 0 && !open && reasons.length > 0 && (
          <button onClick={() => setOpen(true)} className="text-[11px] text-faint truncate hover:text-fg min-h-8 text-left">
            {reasons.join(", ")}
          </button>
        )}
        {rating !== 0 && !open && reasons.length === 0 && (
          <button onClick={() => setOpen(true)} className="text-[11px] text-faint hover:text-fg min-h-8 px-1">
            Why?
          </button>
        )}
      </div>
      {open && rating !== 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {options.map((r) => {
              const on = reasons.includes(r);
              return (
                <button
                  key={r}
                  onClick={() => toggleReason(r)}
                  className={cn(
                    "text-xs px-2.5 py-1 min-h-8 rounded-full border transition",
                    on ? "border-fg text-fg bg-surface-3" : "border-line-strong text-muted hover:text-fg"
                  )}
                >
                  {r}
                </button>
              );
            })}
          </div>
          {!compact && (
            <input
              aria-label="Note for the AI"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== (current?.note ?? "") && save({ rating, reasons, note })}
              placeholder="Anything else the AI should know? (optional)"
              className="w-full rounded-[10px] bg-bg border border-line px-3 py-1.5 text-base sm:text-sm text-fg placeholder:text-faint focus:outline-none focus:border-line-strong"
            />
          )}
          <button onClick={() => setOpen(false)} className="text-[11px] text-faint hover:text-fg min-h-8 px-1">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
