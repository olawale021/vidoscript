"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Check, Copy, Loader2, Wand2 } from "lucide-react";
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
    <section>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3.5">
        <h3 className="text-sm font-semibold">Post copy</h3>
        <Button size="sm" variant={caption ? "ghost" : "default"} onClick={generate} disabled={busy}>
          {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wand2 size={14} className="mr-1" />}
          {caption ? "Rewrite" : "Generate caption"}
        </Button>
      </div>

      {caption || tags.length ? (
        <>
          <div className="grid gap-2 border-b border-line px-4 py-3">
          <span className="text-xs text-faint">Caption</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => persist(caption, tags)}
            rows={5}
            className="min-h-[60px] w-full resize-y rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 text-base text-fg outline-none focus:border-neutral-600 sm:text-sm"
          />
          </div>
          <div className="grid gap-2 border-b border-line px-4 py-3">
          <span className="text-xs text-faint">Hashtags</span>
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
                className="h-8 w-[calc(50%-0.2rem)] rounded-full border border-line-strong bg-transparent px-3 text-base text-muted outline-none focus:border-fg focus:text-fg sm:w-[7.5rem] sm:text-xs"
              />
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={async () => {
              await navigator.clipboard.writeText(full);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
            {copied ? "Copied" : "Copy caption and tags"}
          </Button>
          </div>
        </>
      ) : (
        <p className="px-4 py-3 text-xs text-faint">
          Writes a hook-first caption and exactly 5 hashtags from what&apos;s said in this clip.
        </p>
      )}
      {error && <p className="px-4 py-2 text-xs text-bad">{error}</p>}
    </section>
  );
}
