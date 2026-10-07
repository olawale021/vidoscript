"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lightbulb, Loader2, ScrollText, Sparkles, X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import type { InstagramPost } from "@/types/instagram";

interface Angle {
  label: string;
  topic: string;
  hook: string;
}

interface GenerateAnglesProps {
  post: InstagramPost;
  // Engagement multiple vs the creator's baseline, when known (Top Performers)
  multiplier?: number;
}

// "Steal the topic, not the content" — turns a post into 5 original angles,
// each saveable to the Idea Bank or scriptable on the spot.
export function GenerateAngles({ post, multiplier }: GenerateAnglesProps) {
  const router = useRouter();
  const addIdea = useMutation(api.ideas.add);
  const writeScript = useMutation(api.ideas.writeScript);

  const [state, setState] = useState<"idle" | "loading" | "open" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [topicSummary, setTopicSummary] = useState<string | null>(null);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  const generate = async () => {
    if (state === "loading") return;
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/ideas/angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: post.caption?.text ?? null,
          creatorHandle: post.user.username,
          multiplier,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate angles");
      setTopicSummary(data.topicSummary ?? null);
      setAngles(data.angles);
      setSavedIdx(new Set());
      setState("open");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const saveAngle = async (angle: Angle, idx: number) => {
    if (busyIdx !== null || savedIdx.has(idx)) return;
    setBusyIdx(idx);
    try {
      await addIdea({
        topic: angle.topic,
        hook: angle.hook || null,
        source: "angles",
        sourceCreatorHandle: post.user.username,
        sourceShortcode: post.code,
      });
      setSavedIdx((prev) => new Set(prev).add(idx));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the idea");
    } finally {
      setBusyIdx(null);
    }
  };

  const scriptAngle = async (angle: Angle, idx: number) => {
    if (busyIdx !== null) return;
    setBusyIdx(idx);
    try {
      const ideaId = await addIdea({
        topic: angle.topic,
        hook: angle.hook || null,
        source: "angles",
        sourceCreatorHandle: post.user.username,
        sourceShortcode: post.code,
      });
      const projectId = await writeScript({ id: ideaId });
      router.push(`/dashboard/project/${projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the script");
      setBusyIdx(null);
    }
  };

  return (
    <>
      <button
        onClick={generate}
        disabled={state === "loading"}
        title="Turn this post's topic into 5 original angles for your own content"
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition",
          "border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-500"
        )}
      >
        {state === "loading" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Sparkles size={13} />
        )}
        {state === "loading" ? "Generating..." : "Generate my angles"}
      </button>
      {state === "error" && error && (
        <span className="text-xs text-red-400 self-center">{error}</span>
      )}

      {state === "open" && (
        <div
          className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setState("idle");
          }}
        >
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between p-5 border-b border-neutral-800">
              <div>
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Sparkles size={16} /> Your angles on this topic
                </h3>
                {topicSummary && (
                  <p className="text-sm text-neutral-500 mt-1">{topicSummary}</p>
                )}
              </div>
              <button
                onClick={() => setState("idle")}
                className="text-neutral-500 hover:text-white p-1"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-3">
              {error && <p className="text-sm text-red-400">{error}</p>}
              {angles.map((angle, idx) => (
                <div
                  key={idx}
                  className="border border-neutral-800 rounded-lg p-4 bg-neutral-950"
                >
                  <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                    {angle.label}
                  </p>
                  <p className="text-base text-neutral-200">{angle.topic}</p>
                  {angle.hook && (
                    <p className="text-sm text-neutral-500 mt-1">Hook: “{angle.hook}”</p>
                  )}
                  <div className="flex gap-1.5 mt-3">
                    <button
                      onClick={() => saveAngle(angle, idx)}
                      disabled={busyIdx !== null || savedIdx.has(idx)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition",
                        savedIdx.has(idx)
                          ? "border-emerald-800 bg-emerald-900/30 text-emerald-300"
                          : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-500"
                      )}
                    >
                      {busyIdx === idx ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : savedIdx.has(idx) ? (
                        <Check size={12} />
                      ) : (
                        <Lightbulb size={12} />
                      )}
                      {savedIdx.has(idx) ? "Saved to Idea Bank" : "Save idea"}
                    </button>
                    <button
                      onClick={() => scriptAngle(angle, idx)}
                      disabled={busyIdx !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-500 transition"
                    >
                      <ScrollText size={12} /> Write script now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
