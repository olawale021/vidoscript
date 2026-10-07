"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import {
  Search,
  Loader2,
  Play,
  CheckCircle,
  AlertTriangle,
  Feather,
  BadgeCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import type { InstagramPost, InstagramProfile } from "@/types/instagram";

const proxyImage = (url: string) =>
  `/api/instagram/image-proxy?url=${encodeURIComponent(url)}`;

type ItemState = "adding" | "done" | "error";

function postThumb(post: InstagramPost): string | null {
  const c = post.image_versions2?.candidates;
  return c && c.length > 0 ? c[0].url : null;
}

// Search a creator, browse their reels, multi-select, ingest into the Style Bank.
// New samples land in the named style passed via `styleGroup`.
export function StyleCreatorBrowser({ styleGroup }: { styleGroup: string }) {
  const addSample = useMutation(api.styleBank.add);

  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<InstagramProfile | null>(null);
  const [reels, setReels] = useState<InstagramPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingesting, setIngesting] = useState(false);
  const [itemState, setItemState] = useState<Record<string, ItemState>>({});

  const search = async () => {
    const username = query.trim().replace(/^@/, "");
    if (!username || loading) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    setReels([]);
    setSelected(new Set());
    setItemState({});
    try {
      const pRes = await fetch(`/api/instagram/profile?username=${encodeURIComponent(username)}`);
      const pData = await pRes.json();
      if (!pRes.ok) throw new Error(pData.error || "Creator not found");
      setProfile(pData);

      const fRes = await fetch(`/api/instagram?user_id=${pData.pk}`);
      const fData = await fRes.json();
      if (!fRes.ok) throw new Error(fData.error || "Could not load posts");
      const videos = (fData.items || []).filter(
        (p: InstagramPost) => p.media_type === 2 && p.video_versions?.[0]?.url
      );
      setReels(videos);
      if (videos.length === 0) setError("No video posts found for this creator.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    if (ingesting || itemState[id] === "done") return;
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSelected = async () => {
    if (!profile || selected.size === 0 || ingesting) return;
    setIngesting(true);
    const ids = [...selected];
    for (const id of ids) {
      const post = reels.find((p) => p.id === id);
      const videoUrl = post?.video_versions?.[0]?.url;
      if (!post || !videoUrl) continue;
      setItemState((s) => ({ ...s, [id]: "adding" }));
      try {
        const res = await fetch("/api/style/ingest-instagram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoUrl, handle: profile.username }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Ingest failed");
        await addSample({
          source: "instagram",
          creatorHandle: profile.username,
          styleGroup,
          title: post.caption?.text?.slice(0, 48) || data.title || `@${profile.username} reel`,
          transcript: data.transcript,
          structuredTranscript: data.structuredTranscript ?? null,
          themes: data.themes ?? [],
          hook: data.hook ?? null,
        });
        setItemState((s) => ({ ...s, [id]: "done" }));
        setSelected((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      } catch {
        setItemState((s) => ({ ...s, [id]: "error" }));
      }
    }
    setIngesting(false);
  };

  return (
    <div className="border border-neutral-800 rounded-lg p-4 space-y-3">
      <span className="text-xs font-semibold tracking-widest uppercase text-neutral-500">
        Learn from a creator
      </span>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            disabled={loading || ingesting}
            placeholder="Instagram username, e.g. garyvee"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-md pl-8 pr-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500"
          />
        </div>
        <Button size="sm" variant="outline" onClick={search} disabled={loading || ingesting || !query.trim()}>
          {loading ? <Loader2 className="mr-1.5 animate-spin" size={14} /> : <Search className="mr-1.5" size={14} />}
          Search
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {/* Profile header */}
      {profile && (
        <div className="flex items-center gap-3 pt-1">
          {profile.profile_pic_url && (
            <img
              src={proxyImage(profile.profile_pic_url)}
              alt={profile.username}
              className="w-10 h-10 rounded-full border border-neutral-700"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white flex items-center gap-1">
              @{profile.username}
              {profile.is_verified && <BadgeCheck size={13} className="text-blue-400" />}
            </p>
            <p className="text-xs text-neutral-500">
              {reels.length} video post{reels.length === 1 ? "" : "s"} · selected reels go into “{styleGroup}”
            </p>
          </div>
          {selected.size > 0 && (
            <Button size="sm" onClick={addSelected} disabled={ingesting}>
              {ingesting ? (
                <Loader2 className="mr-1.5 animate-spin" size={14} />
              ) : (
                <Feather className="mr-1.5" size={14} />
              )}
              {ingesting ? "Transcribing..." : `Add ${selected.size} to Style Bank`}
            </Button>
          )}
        </div>
      )}

      {/* Reels grid */}
      {reels.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {reels.map((post) => {
            const thumb = postThumb(post);
            const state = itemState[post.id];
            const isSelected = selected.has(post.id);
            return (
              <button
                key={post.id}
                onClick={() => toggle(post.id)}
                disabled={ingesting || state === "done"}
                className={cn(
                  "relative aspect-[3/4] rounded-md overflow-hidden border-2 transition group",
                  isSelected
                    ? "border-white"
                    : state === "done"
                    ? "border-emerald-600"
                    : "border-transparent hover:border-neutral-500"
                )}
              >
                {thumb ? (
                  <img src={proxyImage(thumb)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
                    <Play size={16} className="text-neutral-600" />
                  </div>
                )}
                {/* State overlay */}
                <div className={cn(
                  "absolute inset-0 flex items-center justify-center transition",
                  isSelected ? "bg-black/40" : state ? "bg-black/50" : "bg-transparent group-hover:bg-black/25"
                )}>
                  {state === "adding" ? (
                    <Loader2 size={18} className="animate-spin text-white" />
                  ) : state === "done" ? (
                    <CheckCircle size={18} className="text-emerald-400" />
                  ) : state === "error" ? (
                    <AlertTriangle size={18} className="text-red-400" />
                  ) : isSelected ? (
                    <CheckCircle size={18} className="text-white" />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
