"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  Check,
  CheckCircle,
  Clapperboard,
  ExternalLink,
  Hash,
  Instagram,
  Lightbulb,
  Loader2,
  MessageCircle,
  Pencil,
  ScrollText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "idea" | "scripted" | "posted" | "archived";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "idea", label: "💡 Ideas" },
  { key: "scripted", label: "✍️ Scripted" },
  { key: "posted", label: "✅ Posted" },
  { key: "archived", label: "Archived" },
];

const SOURCE_META: Record<string, { label: string; icon: typeof Lightbulb }> = {
  profile_outlier: { label: "outlier", icon: Sparkles },
  angles: { label: "angles", icon: Sparkles },
  comments: { label: "comments", icon: MessageCircle },
  hashtag: { label: "hashtag", icon: Hash },
  pillar: { label: "pillar", icon: Instagram },
  library: { label: "library", icon: Clapperboard },
  manual: { label: "manual", icon: Lightbulb },
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function IdeasPage() {
  const router = useRouter();
  const ideas = useQuery(api.ideas.list);
  const addIdea = useMutation(api.ideas.add);
  const updateIdea = useMutation(api.ideas.update);
  const setStatus = useMutation(api.ideas.setStatus);
  const removeIdea = useMutation(api.ideas.remove);
  const writeScript = useMutation(api.ideas.writeScript);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [newTopic, setNewTopic] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writingId, setWritingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState("");
  const [editHook, setEditHook] = useState("");

  const visible = useMemo(() => {
    if (!ideas) return [];
    if (filter === "all") return ideas.filter((i) => i.status !== "archived");
    return ideas.filter((i) => i.status === filter);
  }, [ideas, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, idea: 0, scripted: 0, posted: 0, archived: 0 };
    for (const i of ideas ?? []) {
      c[i.status] += 1;
      if (i.status !== "archived") c.all += 1;
    }
    return c;
  }, [ideas]);

  const handleAdd = async () => {
    const topic = newTopic.trim();
    if (!topic || adding) return;
    setAdding(true);
    setError(null);
    try {
      await addIdea({ topic });
      setNewTopic("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the idea");
    } finally {
      setAdding(false);
    }
  };

  const handleWriteScript = async (id: Id<"ideas">) => {
    if (writingId) return;
    setWritingId(id);
    setError(null);
    try {
      const projectId = await writeScript({ id });
      router.push(`/dashboard/project/${projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the script");
      setWritingId(null);
    }
  };

  const startEdit = (idea: { id: string; topic: string; hook: string | null }) => {
    setEditingId(idea.id);
    setEditTopic(idea.topic);
    setEditHook(idea.hook ?? "");
  };

  const saveEdit = async (id: Id<"ideas">) => {
    try {
      await updateIdea({ id, topic: editTopic, hook: editHook.trim() || null });
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes");
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-medium tracking-tight mb-2">Idea Bank</h1>
      <p className="text-neutral-500 text-base mb-6">
        Your topic backlog — capture ideas the moment you see them, script them when
        you&apos;re ready. Never start Monday with a blank page.
      </p>

      {/* Quick add */}
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Lightbulb
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            value={newTopic}
            onChange={(e) => {
              setNewTopic(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            disabled={adding}
            placeholder='Got an idea? Type it and hit Enter — e.g. "3 mistakes new lifters make"'
            className="w-full bg-transparent border border-neutral-700 rounded-md pl-9 pr-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>
        <Button onClick={handleAdd} disabled={!newTopic.trim() || adding}>
          {adding ? <Loader2 className="animate-spin" size={15} /> : "Save idea"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      {/* Status filter chips */}
      <div className="flex gap-1.5 flex-wrap mt-4 mb-6">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium border transition",
              filter === key
                ? "border-white bg-white/10 text-white"
                : "border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600"
            )}
          >
            {label}
            {ideas !== undefined && (
              <span className="ml-1.5 text-xs text-neutral-500">{counts[key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {ideas === undefined ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-neutral-600" size={22} />
        </div>
      ) : visible.length === 0 ? (
        <div className="border border-dashed border-neutral-800 rounded-lg p-14 text-center">
          <Lightbulb className="mx-auto mb-4 text-neutral-600" size={24} />
          <p className="text-base font-medium mb-1">
            {filter === "all" ? "No ideas yet" : "Nothing here"}
          </p>
          <p className="text-sm text-neutral-500">
            {filter === "all"
              ? "Type one above, or save them while browsing Instagram Posts and your Library."
              : "Ideas will show up here as their status changes."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((idea) => {
            const source = SOURCE_META[idea.source] ?? SOURCE_META.manual;
            const SourceIcon = source.icon;
            const isEditing = editingId === idea.id;
            return (
              <div
                key={idea.id}
                className="border border-neutral-800 rounded-lg p-4 bg-neutral-950 group"
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      value={editTopic}
                      onChange={(e) => setEditTopic(e.target.value)}
                      autoFocus
                      className="w-full bg-transparent border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:border-neutral-500"
                    />
                    <input
                      value={editHook}
                      onChange={(e) => setEditHook(e.target.value)}
                      placeholder="Hook line (optional)"
                      className="w-full bg-transparent border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
                    />
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        className="text-xs"
                        disabled={!editTopic.trim()}
                        onClick={() => saveEdit(idea.id)}
                      >
                        <Check size={13} className="mr-1" /> Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={13} className="mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-base text-neutral-200 font-medium">{idea.topic}</p>
                      {idea.hook && (
                        <p className="text-sm text-neutral-500 mt-0.5">
                          Hook: “{idea.hook}”
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-neutral-600">
                        <span className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-full px-2 py-0.5">
                          <SourceIcon size={11} />
                          {idea.sourceCreatorHandle
                            ? `@${idea.sourceCreatorHandle}`
                            : source.label}
                        </span>
                        <span>{formatDate(idea.createdAt)}</span>
                        {idea.status === "posted" && (
                          <span className="flex items-center gap-1 text-emerald-500">
                            <CheckCircle size={11} /> posted
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {idea.status === "idea" && (
                        <Button
                          size="sm"
                          className="text-xs"
                          disabled={writingId !== null}
                          onClick={() => handleWriteScript(idea.id)}
                        >
                          {writingId === idea.id ? (
                            <Loader2 className="animate-spin" size={13} />
                          ) : (
                            <>
                              <ScrollText size={13} className="mr-1" /> Write script
                            </>
                          )}
                        </Button>
                      )}
                      {idea.status === "scripted" && (
                        <>
                          {idea.projectId && (
                            <Button size="sm" variant="outline" className="text-xs" asChild>
                              <Link href={`/dashboard/project/${idea.projectId}`}>
                                <ExternalLink size={13} className="mr-1" /> Open script
                              </Link>
                            </Button>
                          )}
                          <button
                            title="Mark as posted"
                            onClick={() => void setStatus({ id: idea.id, status: "posted" })}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-emerald-400 hover:bg-neutral-800 transition"
                          >
                            <CheckCircle size={14} />
                          </button>
                        </>
                      )}
                      {idea.status !== "archived" ? (
                        <>
                          <button
                            title="Edit"
                            onClick={() => startEdit(idea)}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            title="Archive"
                            onClick={() => void setStatus({ id: idea.id, status: "archived" })}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition"
                          >
                            <Archive size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            title="Restore to ideas"
                            onClick={() => void setStatus({ id: idea.id, status: "idea" })}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition"
                          >
                            <Lightbulb size={14} />
                          </button>
                          <button
                            title="Delete forever"
                            onClick={() => {
                              if (confirm("Delete this idea permanently?")) {
                                void removeIdea({ id: idea.id });
                              }
                            }}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
