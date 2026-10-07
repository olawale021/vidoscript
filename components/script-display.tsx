"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Edit3, Eye, Sparkles, Target, MessageSquare, RefreshCw, Play, Pause, Volume2, VolumeX, Mic, Check, X, Loader2, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface SectionInfo {
  type: "hook" | "body" | "cta" | "point" | "text";
  label?: string;
  index: number;
}

interface ScriptDisplayProps {
  script: string;
  onChange: (script: string) => void;
  onRegenerateSection?: (section: SectionInfo) => Promise<string>;
  onRegenerateSectionVariations?: (section: SectionInfo) => Promise<string[]>;
  onChatRewriteSection?: (section: SectionInfo, sectionContent: string, instruction: string) => Promise<string[]>;
  readOnly?: boolean;
  videoUrl?: string | null;
  segments?: { start: number; end: number; text: string }[];
  gridLayout?: boolean;
}

interface ScriptSection {
  type: "hook" | "body" | "cta" | "point" | "text";
  content: string;
  label?: string;
}

function normalizeMarkers(script: string): string {
  return script.replace(/\[HOOK\]/gi, "\n[HOOK]\n")
    .replace(/\[BODY\]/gi, "\n[BODY]\n")
    .replace(/\[CTA\]/gi, "\n[CTA]\n")
    .replace(/\[CALL TO ACTION\]/gi, "\n[CALL TO ACTION]\n")
    .replace(/\[POINT\s*(\d+)\]/gi, "\n[POINT $1]\n");
}

function parseScript(script: string): ScriptSection[] {
  const sections: ScriptSection[] = [];
  const lines = normalizeMarkers(script).split("\n");

  let currentSection: ScriptSection | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (currentSection && buffer.length > 0) {
      currentSection.content = buffer.join("\n").trim();
      if (currentSection.content) {
        sections.push(currentSection);
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.match(/^\[HOOK\]$/i) || trimmed.match(/^HOOK:?$/i)) {
      flushBuffer();
      currentSection = { type: "hook", content: "" };
    } else if (trimmed.match(/^\[BODY\]$/i) || trimmed.match(/^BODY:?$/i)) {
      flushBuffer();
      currentSection = { type: "body", content: "" };
    } else if (trimmed.match(/^\[CTA\]$/i) || trimmed.match(/^CTA:?$/i) || trimmed.match(/^\[CALL TO ACTION\]$/i)) {
      flushBuffer();
      currentSection = { type: "cta", content: "" };
    } else if (trimmed.match(/^\[POINT\s*\d+\]$/i)) {
      flushBuffer();
      const num = trimmed.match(/\d+/)![0];
      currentSection = { type: "point", content: "", label: `${num}` };
    } else if (trimmed === "---") {
      // Skip dividers
    } else {
      if (!currentSection) {
        currentSection = { type: "text", content: "" };
      }
      buffer.push(line);
    }
  }

  flushBuffer();

  return sections;
}

function rebuildScript(sections: ScriptSection[]): string {
  return sections.map((s) => {
    let header = "";
    if (s.type === "hook") header = "[HOOK]";
    else if (s.type === "body") header = "[BODY]";
    else if (s.type === "cta") header = "[CTA]";
    else if (s.type === "point") header = `[POINT ${s.label}]`;

    return header ? `${header}\n${s.content}` : s.content;
  }).join("\n\n");
}

function getSectionIcon(type: ScriptSection["type"]) {
  switch (type) {
    case "hook": return Sparkles;
    case "cta": return Target;
    case "point": return null;
    case "body": return MessageSquare;
    default: return null;
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function computeSectionTimestamps(
  sections: ScriptSection[],
  segments: { start: number; end: number; text: string }[]
): { start: number; end: number }[] {
  if (!segments.length) return [];

  const wordTimeline: { word: string; start: number; end: number }[] = [];
  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const dur = (seg.end - seg.start) / words.length;
    for (let i = 0; i < words.length; i++) {
      wordTimeline.push({
        word: words[i].toLowerCase().replace(/[^\w]/g, ""),
        start: seg.start + dur * i,
        end: seg.start + dur * (i + 1),
      });
    }
  }

  if (wordTimeline.length === 0) return [];

  const results: { start: number; end: number }[] = [];
  let wordIdx = 0;

  for (const section of sections) {
    const sectionWords = normalizeText(section.content).split(" ").filter(Boolean);

    if (sectionWords.length === 0 || wordIdx >= wordTimeline.length) {
      const fallback = wordTimeline[wordIdx] || wordTimeline[wordTimeline.length - 1];
      results.push({ start: fallback.start, end: fallback.end });
      continue;
    }

    const startTime = wordTimeline[wordIdx].start;
    let endTime = wordTimeline[wordIdx].end;

    const wordsToConsume = sectionWords.length;
    for (let i = 0; i < wordsToConsume && wordIdx < wordTimeline.length; i++) {
      endTime = wordTimeline[wordIdx].end;
      wordIdx++;
    }

    results.push({ start: startTime, end: endTime });
  }

  return results;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ClippedVideo({ src, start, end }: { src: string; start: number; end: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [clipTime, setClipTime] = useState(0);
  const clipDuration = end - start;

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.currentTime = start;
  }, [start]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const relative = v.currentTime - start;
    setClipTime(Math.max(0, Math.min(relative, clipDuration)));

    if (v.currentTime >= end) {
      v.pause();
      v.currentTime = end;
      setPlaying(false);
    }
  }, [start, end, clipDuration]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    if (v.paused) {
      if (v.currentTime >= end - 0.1) {
        v.currentTime = start;
        setClipTime(0);
      }
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [start, end]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    const bar = progressRef.current;
    if (!v || !bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = start + pct * clipDuration;
    v.currentTime = newTime;
    setClipTime(pct * clipDuration);
  }, [start, clipDuration]);

  const progress = clipDuration > 0 ? (clipTime / clipDuration) * 100 : 0;

  return (
    <div className="mb-2 rounded-md overflow-hidden border border-neutral-800 relative group/video">
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        className="w-full aspect-video bg-black cursor-pointer"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v) v.currentTime = start;
        }}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
      />

      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity"
        >
          <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play size={18} className="text-white ml-0.5" fill="white" />
          </div>
        </button>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 opacity-0 group-hover/video:opacity-100 transition-opacity">
        <div
          ref={progressRef}
          className="w-full h-1 bg-neutral-700 rounded-full cursor-pointer mb-2"
          onClick={handleProgressClick}
        >
          <div
            className="h-full bg-white rounded-full transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="text-white">
              {playing ? <Pause size={14} fill="white" /> : <Play size={14} fill="white" className="ml-0.5" />}
            </button>
            <button onClick={toggleMute} className="text-white">
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
          <span className="text-xs font-mono font-semibold text-neutral-300">
            {formatTime(clipTime)} / {formatTime(clipDuration)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Inline section editor with variations and chat
function SectionEditor({
  section,
  sectionIndex,
  sections,
  onChange,
  onRegenerateSectionVariations,
  onChatRewriteSection,
  onClose,
}: {
  section: ScriptSection;
  sectionIndex: number;
  sections: ScriptSection[];
  onChange: (script: string) => void;
  onRegenerateSectionVariations?: (section: SectionInfo) => Promise<string[]>;
  onChatRewriteSection?: (section: SectionInfo, sectionContent: string, instruction: string) => Promise<string[]>;
  onClose: () => void;
}) {
  const [editText, setEditText] = useState(section.content);
  const [variations, setVariations] = useState<string[]>([]);
  const [isLoadingVariations, setIsLoadingVariations] = useState(false);
  const [selectedVariation, setSelectedVariation] = useState<number | null>(null);
  const [variationPage, setVariationPage] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const updated = [...sections];
    updated[sectionIndex] = { ...updated[sectionIndex], content: editText };
    onChange(rebuildScript(updated));
    onClose();
  };

  const handleRewrite = async () => {
    if (!onRegenerateSectionVariations) return;
    setIsLoadingVariations(true);
    setVariations([]);
    setSelectedVariation(null);
    setVariationPage(0);

    try {
      const results = await onRegenerateSectionVariations({
        type: section.type,
        label: section.label,
        index: sectionIndex,
      });
      setVariations(results);
    } catch {
      // silently fail
    } finally {
      setIsLoadingVariations(false);
    }
  };

  const handlePickVariation = (index: number) => {
    setSelectedVariation(index);
    setEditText(variations[index]);
  };

  const handleChatSend = async () => {
    if (!onChatRewriteSection || !chatInput.trim() || isChatLoading) return;
    setIsChatLoading(true);
    setVariations([]);
    setSelectedVariation(null);
    setVariationPage(0);

    try {
      const results = await onChatRewriteSection(
        { type: section.type, label: section.label, index: sectionIndex },
        editText,
        chatInput.trim()
      );
      setVariations(results);
      if (results.length > 0) {
        setEditText(results[0]);
        setSelectedVariation(0);
      }
      setChatInput("");
    } catch {
      // silently fail
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  };

  return (
    <div className="space-y-3">
      {/* Textarea for direct editing */}
      <Textarea
        value={editText}
        onChange={(e) => {
          setEditText(e.target.value);
          setSelectedVariation(null);
        }}
        className="min-h-[80px] text-base leading-relaxed bg-neutral-900 border-neutral-700 resize-none focus-visible:ring-1 focus-visible:ring-neutral-600"
        autoFocus
      />

      {/* Chat input */}
      {onChatRewriteSection && (
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              ref={chatInputRef}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder="Tell AI how to rewrite this..."
              disabled={isChatLoading}
              className="w-full px-3 py-2 pr-9 rounded-md bg-neutral-800 border border-neutral-700 text-base text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-600 disabled:opacity-50"
            />
            <button
              onClick={handleChatSend}
              disabled={!chatInput.trim() || isChatLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white disabled:opacity-30 transition"
            >
              {isChatLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-black text-sm font-medium hover:bg-neutral-200 transition"
          >
            <Check size={12} />
            Save
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 text-neutral-400 text-sm font-medium hover:bg-neutral-700 hover:text-neutral-300 transition"
          >
            <X size={12} />
            Cancel
          </button>
        </div>

        {onRegenerateSectionVariations && (
          <button
            onClick={handleRewrite}
            disabled={isLoadingVariations}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 text-neutral-400 text-sm font-medium hover:bg-neutral-700 hover:text-neutral-300 transition disabled:opacity-50"
          >
            {isLoadingVariations ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {isLoadingVariations ? "Rewriting..." : "Rewrite"}
          </button>
        )}
      </div>

      {/* Variations carousel */}
      {variations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider">
              {variations.length} variations
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setVariationPage(Math.max(0, variationPage - 1))}
                disabled={variationPage === 0}
                className="p-1 text-neutral-500 hover:text-white disabled:opacity-30 transition"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-neutral-500 font-mono">
                {variationPage + 1}/{variations.length}
              </span>
              <button
                onClick={() => setVariationPage(Math.min(variations.length - 1, variationPage + 1))}
                disabled={variationPage === variations.length - 1}
                className="p-1 text-neutral-500 hover:text-white disabled:opacity-30 transition"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <button
            onClick={() => handlePickVariation(variationPage)}
            className={cn(
              "w-full text-left p-3 rounded-md border text-base leading-relaxed transition-all whitespace-pre-wrap",
              selectedVariation === variationPage
                ? "border-white/30 bg-neutral-800 text-neutral-200"
                : "border-neutral-800 bg-neutral-900/50 text-neutral-400 hover:border-neutral-700 hover:text-neutral-300"
            )}
          >
            {variations[variationPage]}
          </button>
        </div>
      )}
    </div>
  );
}

export function ScriptDisplay({ script, onChange, onRegenerateSection, onRegenerateSectionVariations, onChatRewriteSection, readOnly, videoUrl, segments, gridLayout }: ScriptDisplayProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const sections = parseScript(script);
  const hasSections = sections.some((s) => s.type !== "text");

  const sectionTimestamps = useMemo(() => {
    if (!segments?.length || !hasSections) return [];
    return computeSectionTimestamps(sections, segments);
  }, [script, segments]);

  // Shared per-section body (label row + video + content/editor), used by both
  // the timeline layout and the grid layout. `grid` prepends an inline badge.
  const sectionBody = (section: ScriptSection, index: number, grid: boolean) => {
    const Icon = getSectionIcon(section.type);
    const isHook = section.type === "hook";
    const isCta = section.type === "cta";
    const isPoint = section.type === "point";
    const isEditingThis = editingSectionIndex === index;
    const ts = sectionTimestamps[index];
    const showVideo = videoUrl && ts;

    const badge = isPoint ? (
      <span className="w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-semibold bg-neutral-800 text-neutral-400 border border-neutral-700">
        {section.label}
      </span>
    ) : (
      <span className={cn(
        "w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center",
        isHook && "bg-emerald-900/50 border border-emerald-700",
        isCta && "bg-amber-900/50 border border-amber-700",
        !isHook && !isCta && "bg-neutral-800 border border-neutral-700"
      )}>
        {Icon && <Icon size={11} className={cn(
          isHook && "text-emerald-400",
          isCta && "text-amber-400",
          !isHook && !isCta && "text-neutral-500"
        )} />}
      </span>
    );

    return (
      <>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            {grid && badge}
            <span className={cn(
              "text-xs font-semibold tracking-widest uppercase",
              isHook && "text-emerald-400",
              isCta && "text-amber-400",
              isPoint && "text-neutral-500",
              !isHook && !isCta && !isPoint && "text-neutral-500"
            )}>
              {isHook ? "Hook" : isCta ? "Call to Action" : isPoint ? `Point ${section.label}` : "Body"}
            </span>
            {ts && (
              <span className="text-xs text-neutral-600 font-mono font-semibold">
                {formatTimestamp(ts.start)} – {formatTimestamp(ts.end)}
              </span>
            )}
          </div>
          {!readOnly && !isEditingThis && (
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={() => setEditingSectionIndex(index)}
                className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition"
              >
                <Edit3 size={10} />
                Edit
              </button>
              <button
                disabled
                className="flex items-center gap-1 text-xs text-neutral-600 cursor-not-allowed"
                title="Voiceover coming soon"
              >
                <Mic size={10} />
                Voice
              </button>
            </div>
          )}
        </div>

        {showVideo && <ClippedVideo src={videoUrl} start={ts.start} end={ts.end} />}

        {isEditingThis ? (
          <SectionEditor
            section={section}
            sectionIndex={index}
            sections={sections}
            onChange={onChange}
            onRegenerateSectionVariations={onRegenerateSectionVariations}
            onChatRewriteSection={onChatRewriteSection}
            onClose={() => setEditingSectionIndex(null)}
          />
        ) : (
          <div className={cn(
            "text-base leading-relaxed whitespace-pre-wrap",
            isHook && "text-neutral-200",
            isCta && "text-neutral-300",
            !isHook && !isCta && "text-neutral-400"
          )}>
            {section.content}
          </div>
        )}
      </>
    );
  };

  if (!readOnly && (isEditing || !hasSections)) {
    return (
      <div className="relative">
        {hasSections && (
          <button
            onClick={() => setIsEditing(false)}
            className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-white transition"
          >
            <Eye size={12} />
            Preview
          </button>
        )}
        <Textarea
          value={script}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[580px] border-0 rounded-none resize-none focus-visible:ring-0 text-base leading-relaxed p-5 pr-20 bg-neutral-900"
          placeholder="Your generated script will appear here..."
        />
      </div>
    );
  }

  return (
    <div className="relative">
      {!readOnly && (
        <button
          onClick={() => setIsEditing(true)}
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-white transition"
        >
          <Edit3 size={12} />
          Raw
        </button>
      )}

      <div className="p-5 min-h-[580px] overflow-y-auto">
        {gridLayout ? (
          /* Grid layout — cards, for wide/maximized panels */
          <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
            {sections.map((section, index) => {
              if (section.type === "text") {
                return (
                  <div key={index} className="md:col-span-2 2xl:col-span-3 text-neutral-300 text-base leading-relaxed whitespace-pre-wrap">
                    {section.content}
                  </div>
                );
              }
              return (
                <div key={index} className="group rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-neutral-700">
                  {sectionBody(section, index, true)}
                </div>
              );
            })}
          </div>
        ) : (
          /* Timeline layout — vertical, for the split view */
          <div className="relative pl-8">
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-neutral-700" />
            <div className="space-y-1">
              {sections.map((section, index) => {
                if (section.type === "text") {
                  return (
                    <div key={index} className="text-neutral-300 text-base leading-relaxed whitespace-pre-wrap py-2">
                      {section.content}
                    </div>
                  );
                }

                const Icon = getSectionIcon(section.type);
                const isHook = section.type === "hook";
                const isCta = section.type === "cta";
                const isPoint = section.type === "point";

                return (
                  <div key={index} className="relative group py-3">
                    {/* Timeline dot / number */}
                    <div className="absolute -left-8 w-[23px] flex justify-center">
                      {isPoint ? (
                        <span className="w-[23px] h-[23px] rounded-full flex items-center justify-center text-xs font-semibold mt-0.5 bg-neutral-800 text-neutral-400 border border-neutral-700">
                          {section.label}
                        </span>
                      ) : (
                        <span className={cn(
                          "w-[23px] h-[23px] rounded-full flex items-center justify-center mt-0.5",
                          isHook && "bg-emerald-900/50 border border-emerald-700",
                          isCta && "bg-amber-900/50 border border-amber-700",
                          !isHook && !isCta && "bg-neutral-800 border border-neutral-700"
                        )}>
                          {Icon && <Icon size={10} className={cn(
                            isHook && "text-emerald-400",
                            isCta && "text-amber-400",
                            !isHook && !isCta && "text-neutral-500"
                          )} />}
                        </span>
                      )}
                    </div>

                    {sectionBody(section, index, false)}

                    {index < sections.length - 1 && (
                      <div className="border-b border-neutral-800 mt-3" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
