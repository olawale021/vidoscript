"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  Upload,
  Loader2,
  Trash2,
  CheckCircle,
  AlertTriangle,
  FileAudio,
  Instagram,
  AtSign,
  Feather,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { transcribeFile } from "@/app/actions/transcribe";
import { StyleCreatorBrowser } from "@/components/style-creator-browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type FileStatus = { name: string; state: "transcribing" | "analyzing" | "done" | "error"; error?: string };

function extractHook(structured: string | null | undefined): string | null {
  if (!structured) return null;
  const m = structured.match(/\[HOOK\]\s*\n?([\s\S]*?)(?=\n\s*\[|$)/i);
  return m ? m[1].trim() : null;
}

export default function StyleBankPage() {
  const samples = useQuery(api.styleBank.list) ?? [];
  const groups = useQuery(api.styleBank.groups) ?? [];
  const addSample = useMutation(api.styleBank.add);
  const removeSample = useMutation(api.styleBank.remove);
  const setGroup = useMutation(api.styleBank.setGroup);

  // The named style new samples go into — any mix of creators/uploads.
  const [styleGroup, setStyleGroup] = useState("My style");
  const [queue, setQueue] = useState<FileStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const groupNames = useMemo(() => {
    const names = new Set<string>(["My style"]);
    for (const g of groups) names.add(g.name);
    return [...names];
  }, [groups]);

  const processFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setQueue(files.map((f) => ({ name: f.name, state: "transcribing" })));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const setState = (patch: Partial<FileStatus>) =>
        setQueue((q) => q.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
      try {
        const formData = new FormData();
        formData.append("file", file);
        const t = await transcribeFile(formData);
        if ("error" in t) throw new Error(t.error);

        setState({ state: "analyzing" });
        let structuredTranscript: string | null = null;
        let themes: string[] = [];
        try {
          const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: t.transcript,
              wordCount: t.wordCount,
              durationSeconds: t.segments?.length ? t.segments[t.segments.length - 1].end : 0,
            }),
          });
          if (res.ok) {
            const a = await res.json();
            structuredTranscript = a.structuredTranscript ?? null;
            themes = Array.isArray(a.themes) ? a.themes : [];
          }
        } catch {
          // non-fatal — store the raw transcript
        }

        await addSample({
          source: "upload",
          creatorHandle: null,
          styleGroup: styleGroup.trim() || "My style",
          title: file.name.replace(/\.[^/.]+$/, ""),
          transcript: t.transcript,
          structuredTranscript,
          themes,
          hook: extractHook(structuredTranscript),
        });
        setState({ state: "done" });
      } catch (e) {
        setState({ state: "error", error: e instanceof Error ? e.message : "Failed" });
      }
    }
    setBusy(false);
  };

  return (
    <div className="w-full flex flex-col h-[calc(100vh-2.5rem)]">
      <div className="flex-shrink-0 mb-5">
        <h1 className="text-2xl font-medium mb-1">Style Bank</h1>
        <p className="text-base text-neutral-500">
          Named writing styles the AI mimics. Each style is a set of real transcripts — mix your
          videos and any creators into one style, or keep several styles for different formats.
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6 flex-1 min-h-0">
      {/* Left: add content (target style, uploads, creator browser) */}
      <div className="lg:col-span-2 min-h-0 overflow-y-auto space-y-4 pr-1">
      {/* Target style — shared by uploads and the creator browser */}
      <div className="border border-neutral-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Feather size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={styleGroup}
              onChange={(e) => setStyleGroup(e.target.value)}
              disabled={busy}
              list="style-groups"
              placeholder="Style name — e.g. My style, Hype tech, Storyteller"
              className="w-full bg-neutral-900 border border-neutral-700 rounded-md pl-8 pr-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
            />
            <datalist id="style-groups">
              {groupNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 animate-spin" size={14} /> : <Upload className="mr-1.5" size={14} />}
            {busy ? "Processing..." : "Add videos"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              processFiles(files);
            }}
          />
        </div>
        <p className="text-xs text-neutral-600">
          Everything you add — uploads below or creator reels — goes into “{styleGroup.trim() || "My style"}”.
          Type a new name to start a new style. Mixed topics are good: a style teaches voice, not subject.
        </p>

        {queue.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {queue.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {f.state === "done" ? (
                  <CheckCircle size={13} className="text-emerald-400" />
                ) : f.state === "error" ? (
                  <AlertTriangle size={13} className="text-red-400" />
                ) : (
                  <Loader2 size={13} className="animate-spin text-neutral-500" />
                )}
                <span className="text-neutral-300 truncate">{f.name}</span>
                <span className="text-neutral-600 text-xs">
                  {f.state === "error" ? f.error : f.state}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Creator browser: search, pick reels, ingest into the selected style */}
      <StyleCreatorBrowser styleGroup={styleGroup.trim() || "My style"} />
      </div>

      {/* Right: samples */}
      <div className="lg:col-span-3 min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-xs font-semibold tracking-widest uppercase text-neutral-500">
          {samples.length} sample{samples.length === 1 ? "" : "s"}
          {groups.length > 1 ? ` · ${groups.length} styles` : ""}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {samples.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No samples yet. Add ~10+ videos per style for a real difference; up to ~100 works great.
        </p>
      ) : (
        <div className="space-y-2">
          {samples.map((s) => (
            <div key={s.id} className="group flex items-start gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
              <span className={cn(
                "mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center",
                s.source === "instagram" ? "bg-pink-900/40 text-pink-300" : "bg-neutral-800 text-neutral-400"
              )}>
                {s.source === "instagram" ? <Instagram size={12} /> : <FileAudio size={12} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-200 truncate">{s.title}</span>
                  {s.creatorHandle && (
                    <span className="text-xs text-neutral-500 flex items-center gap-0.5 flex-shrink-0">
                      <AtSign size={9} />{s.creatorHandle}
                    </span>
                  )}
                  <span className="text-xs text-neutral-600 flex-shrink-0">{s.wordCount} words</span>
                </div>
                <p className="text-xs text-neutral-500 truncate mt-0.5">{s.preview}…</p>
              </div>
              {/* Move sample between styles */}
              <select
                value={s.group}
                onChange={(e) => setGroup({ id: s.id as Id<"styleSamples">, styleGroup: e.target.value })}
                title="Which style this sample belongs to"
                className="flex-shrink-0 mt-0.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-emerald-300 px-1.5 py-1 focus:outline-none cursor-pointer max-w-[120px]"
              >
                {[...new Set([s.group, ...groupNames])].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button
                onClick={() => removeSample({ id: s.id as Id<"styleSamples"> })}
                className="text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition flex-shrink-0 mt-1"
                title="Delete sample"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
      </div>
      </div>
    </div>
  );
}
