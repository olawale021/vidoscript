"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clapperboard,
  Instagram,
  Link2,
  Loader2,
  RefreshCw,
  ScrollText,
  Trash2,
  Upload,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// instagram.com/reel/{code}, /reels/, /p/, /tv/ — with or without a username
// segment in front (instagram.com/{user}/reel/{code}).
function parseShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LibraryPage() {
  const router = useRouter();
  const items = useQuery(api.library.list);
  const startImport = useMutation(api.library.startInstagramImport);
  const retryImport = useMutation(api.library.retryImport);
  const removeItem = useMutation(api.library.remove);
  const createProject = useMutation(api.library.createProject);

  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed || importing) return;
    const shortcode = parseShortcode(trimmed);
    if (!shortcode) {
      setError("That doesn't look like an Instagram post link — expected instagram.com/reel/… or /p/…");
      return;
    }
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await startImport({ shortcode, sourceUrl: trimmed });
      setUrl("");
      if (result.existing) setNotice("Already in your library.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleCreateProject = async (id: Id<"libraryItems">) => {
    if (creatingId) return;
    setCreatingId(id);
    setError(null);
    try {
      const projectId = await createProject({ id });
      router.push(`/dashboard/project/${projectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the project");
      setCreatingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-medium tracking-tight mb-2">Library</h1>
      <p className="text-neutral-500 text-base mb-6">
        Videos saved as raw material — import a reel by link, or save posts from the
        Instagram browser. Turn any of them into a script when you&apos;re ready.
      </p>

      {/* Paste-URL import bar */}
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Link2
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
          />
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
              setNotice(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleImport();
            }}
            disabled={importing}
            placeholder="Paste an Instagram reel or post link — https://www.instagram.com/reel/…"
            className="w-full bg-transparent border border-neutral-700 rounded-md pl-9 pr-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>
        <Button onClick={handleImport} disabled={!url.trim() || importing}>
          {importing ? (
            <>
              <Loader2 className="mr-1.5 animate-spin" size={15} /> Importing…
            </>
          ) : (
            "Import"
          )}
        </Button>
      </div>
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
      {notice && <p className="text-sm text-neutral-400 mb-4">{notice}</p>}

      {/* Grid */}
      {items === undefined ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-neutral-600" size={22} />
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-neutral-800 rounded-lg p-14 text-center mt-8">
          <Clapperboard className="mx-auto mb-4 text-neutral-600" size={24} />
          <p className="text-base font-medium mb-1">Your library is empty</p>
          <p className="text-sm text-neutral-500">
            Paste a reel link above, or hit &quot;Save to Library&quot; on any post in
            Instagram Posts.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-8">
          {items.map((item) => (
            <div
              key={item.id}
              className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-950 flex flex-col"
            >
              {/* Media */}
              <div className="relative aspect-[9/12] bg-neutral-900">
                {item.status === "ready" && item.videoUrl ? (
                  <video
                    src={item.videoUrl}
                    poster={item.thumbnailUrl ?? undefined}
                    controls
                    preload="none"
                    className="w-full h-full object-contain"
                  />
                ) : item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="w-full h-full object-cover opacity-50"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Clapperboard size={22} className="text-neutral-700" />
                  </div>
                )}

                {item.status === "importing" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
                    <Loader2 className="animate-spin text-white" size={20} />
                    <span className="text-xs text-neutral-300">Importing…</span>
                  </div>
                )}

                {/* Source badge */}
                <span className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 rounded-full px-2 py-0.5 text-[11px] text-neutral-300">
                  {item.source === "instagram" ? (
                    <Instagram size={11} />
                  ) : (
                    <Upload size={11} />
                  )}
                  {item.creatorHandle ? `@${item.creatorHandle}` : item.source}
                </span>
                {item.durationSec != null && item.status === "ready" && (
                  <span className="absolute top-2 right-2 bg-black/70 rounded-full px-2 py-0.5 text-[11px] text-neutral-300">
                    {Math.floor(item.durationSec)}s
                  </span>
                )}
              </div>

              {/* Info + actions */}
              <div className="p-3 flex flex-col gap-2 flex-1">
                {item.caption && (
                  <p className="text-xs text-neutral-400 line-clamp-2">{item.caption}</p>
                )}
                {item.status === "failed" && (
                  <p className="text-xs text-red-400 line-clamp-3">
                    {item.error || "Import failed"}
                  </p>
                )}
                <div className="mt-auto flex items-center gap-1.5">
                  {item.status === "ready" ? (
                    <Button
                      size="sm"
                      className="flex-1 text-xs"
                      disabled={creatingId !== null}
                      onClick={() => handleCreateProject(item.id)}
                    >
                      {creatingId === item.id ? (
                        <Loader2 className="animate-spin" size={13} />
                      ) : (
                        <>
                          <ScrollText size={13} className="mr-1" /> Create Script
                        </>
                      )}
                    </Button>
                  ) : item.status === "failed" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() =>
                        retryImport({ id: item.id }).catch((e) =>
                          setError(e instanceof Error ? e.message : "Retry failed")
                        )
                      }
                    >
                      <RefreshCw size={13} className="mr-1" /> Retry
                    </Button>
                  ) : (
                    <div className="flex-1" />
                  )}
                  <button
                    title="Delete from library"
                    onClick={() => {
                      if (confirm("Remove this video from your library?")) {
                        void removeItem({ id: item.id });
                      }
                    }}
                    className={cn(
                      "p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition"
                    )}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {item.fileSizeBytes != null && item.status === "ready" && (
                  <p className="text-[11px] text-neutral-600">
                    {formatBytes(item.fileSizeBytes)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
