"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { BookOpen, FileText, Plus, Scissors, Search, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

// ⌘K / Ctrl+K search over the user's scripts, clip videos and stories, plus
// quick actions. Open it from anywhere with openCommandPalette().
const OPEN_EVENT = "vidoscript:open-search";
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

const KIND = {
  script: { icon: FileText, label: "Script" },
  clips: { icon: Scissors, label: "Clips" },
  story: { icon: BookOpen, label: "Story" },
} as const;

const ACTIONS = [
  { title: "New script from a video", href: "/dashboard/new", icon: Plus },
  { title: "Cut clips from a video", href: "/dashboard/clips", icon: Scissors },
  { title: "New story video", href: "/dashboard/stories", icon: Sparkles },
];

function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useQuery(api.search.recent, open ? { q } : "skip");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const rows = useMemo(() => {
    const found = (results ?? []).map((r) => ({ ...r, icon: KIND[r.kind].icon, meta: `${KIND[r.kind].label} · ${ago(r.at)}` }));
    const actions = q.trim()
      ? []
      : ACTIONS.map((a) => ({ kind: "action" as const, id: a.href, title: a.title, href: a.href, icon: a.icon, meta: "Action" }));
    return [...actions, ...found];
  }, [results, q]);

  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(rows.length - 1, s + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === "Enter" && rows[sel]) go(rows[sel].href);
            }}
            placeholder="Search scripts, clips and stories"
            aria-label="Search"
            className="h-12 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint sm:text-[15px]"
          />
          <kbd className="rounded-[5px] border border-line-strong px-1.5 font-mono text-[11px] text-faint">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {results === undefined && q ? (
            <li className="px-3 py-6 text-center text-sm text-faint">Searching…</li>
          ) : rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-faint">Nothing matches “{q}”.</li>
          ) : (
            rows.map((r, i) => {
              const Icon = r.icon;
              return (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(r.href)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
                      i === sel ? "bg-surface-2 text-fg" : "text-muted"
                    )}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                    <span className="flex-shrink-0 text-xs text-faint">{r.meta}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
