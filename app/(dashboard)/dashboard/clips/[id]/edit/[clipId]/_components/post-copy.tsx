"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Check, Copy, Hash, Loader2, Wand2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

const normalize = (h: string) => "#" + h.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");

// AI caption + exactly 5 hashtags for posting the clip. Editable; saved on the clip.
export function PostCopy({
  clipId,
  title,
  hook,
  transcript,
  savedCaption,
  savedHashtags,
}: {
  clipId: Id<"clips">;
  title: string;
  hook: string;
  transcript: string;
  savedCaption?: string;
  savedHashtags?: string[];
}) {
  const save = useMutation(api.clipEditor.setPostCopy);
  const [caption, setCaption] = useState(savedCaption ?? "");
  const [tags, setTags] = useState<string[]>(savedHashtags ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Pick up a saved copy that arrives after mount.
  useEffect(() => {
    if (savedCaption !== undefined && !caption) setCaption(savedCaption);
    if (savedHashtags?.length && tags.length === 0) setTags(savedHashtags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCaption, savedHashtags]);

  const persist = (c: string, t: string[]) => save({ clipId, caption: c, hashtags: t }).catch(() => {});

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clips/post-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, hook, transcript }),
      });
      const data = (await res.json()) as { caption?: string; hashtags?: string[]; error?: string };
      if (!res.ok || !data.caption || !data.hashtags) throw new Error(data.error || "Could not write the caption");
      setCaption(data.caption);
      setTags(data.hashtags);
      await persist(data.caption, data.hashtags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const full = [caption.trim(), tags.join(" ")].filter(Boolean).join("\n\n");

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-300 inline-flex items-center gap-1.5">
          <Hash size={15} className="text-sky-400" /> Post caption
        </h2>
        <Button size="sm" variant={caption ? "outline" : "default"} onClick={generate} disabled={busy}>
          {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
          {caption ? "Regenerate" : "Generate caption"}
        </Button>
      </div>

      {caption || tags.length ? (
        <>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => persist(caption, tags)}
            rows={4}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-200 outline-none focus:border-neutral-600"
          />
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <input
                key={i}
                value={tags[i] ?? ""}
                placeholder="#hashtag"
                onChange={(e) => {
                  const next = [...tags];
                  next[i] = e.target.value;
                  setTags(next);
                }}
                onBlur={() => {
                  const next = tags.map((t) => (t ? normalize(t) : t)).filter((t) => t && t !== "#");
                  setTags(next);
                  persist(caption, next);
                }}
                className="w-[calc(50%-0.2rem)] sm:w-auto sm:min-w-[7rem] rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-sky-300 outline-none focus:border-sky-400"
              />
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(full);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
            {copied ? "Copied" : "Copy caption + hashtags"}
          </Button>
        </>
      ) : (
        <p className="text-xs text-neutral-500">
          Writes a hook-first caption and exactly 5 hashtags from what&apos;s said in this clip.
        </p>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </section>
  );
}
