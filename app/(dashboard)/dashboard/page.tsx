"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  FileText,
  GalleryHorizontal,
  Link2,
  Loader2,
  Scissors,
  Upload,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { HomeItem, HomeKind } from "@/convex/home";
import { Button } from "@/components/ui/button";
import { Bar, StatRow } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

// ── helpers ──

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function fmtDur(sec: number | null): string | null {
  if (sec == null || !isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function isYouTube(input: string): boolean {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (host === "youtu.be") return u.pathname.length > 1;
    if (host !== "youtube.com") return false;
    return (u.pathname === "/watch" && !!u.searchParams.get("v")) || /^\/(shorts|live|embed)\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
}

// Gradient stand-ins (prototype .t1–.t8) for items without a thumbnail.
const GRADIENTS = [
  "radial-gradient(120% 80% at 70% 20%, #f7a35c 0%, #b14a3a 35%, #2a1418 75%)",
  "radial-gradient(90% 70% at 30% 70%, #3fa3a8 0%, #1a4d63 45%, #0b1622 85%)",
  "linear-gradient(160deg, #2b2b31 0%, #57534e 45%, #c8b9a0 100%)",
  "radial-gradient(80% 60% at 50% 40%, #e85d9c 0%, #6b2a7a 45%, #160b1f 85%)",
  "linear-gradient(200deg, #9ec27a 0%, #3f6b3b 45%, #12200f 100%)",
  "radial-gradient(100% 70% at 20% 30%, #ffd88a 0%, #c9853a 40%, #3a2312 85%)",
  "linear-gradient(140deg, #6f8ee8 0%, #2c3c86 50%, #0d1230 100%)",
  "radial-gradient(90% 80% at 60% 60%, #d0d0d0 0%, #6a6a70 45%, #18181b 90%)",
];

function gradientFor(id: string | number): string {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

const KIND: Record<HomeKind, { label: string; icon: typeof FileText; href: (id: string) => string }> = {
  script: { label: "Script", icon: FileText, href: (id) => `/dashboard/project/${id}` },
  clip: { label: "Clip", icon: Scissors, href: (id) => `/dashboard/clips/${id}` },
  story: { label: "Story", icon: BookOpen, href: (id) => `/dashboard/stories/${id}` },
};

// ── command bar ──

type Mode = "script" | "clips" | "story" | "carousel";

const MODES: { key: Mode; label: string; icon: typeof FileText; ph: string }[] = [
  { key: "script", label: "Script", icon: FileText, ph: "Paste a video link to rewrite as your script" },
  { key: "clips", label: "Clips", icon: Scissors, ph: "Paste a YouTube link to cut into clips" },
  { key: "story", label: "Story", icon: BookOpen, ph: "Describe a story, or paste a script to narrate" },
  { key: "carousel", label: "Carousel", icon: GalleryHorizontal, ph: "Paste a post or idea to turn into a carousel" },
];

function CommandBar() {
  const router = useRouter();
  const createFromUrl = useMutation(api.clips.createFromUrl);
  const createStory = useMutation(api.stories.create);

  const [mode, setMode] = useState<Mode>("script");
  const [text, setText] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = text.trim();
  const ytLink = mode === "clips" && isYouTube(value);
  const ph = MODES.find((m) => m.key === mode)!.ph;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    try {
      if (mode === "carousel") {
        router.push("/dashboard/instagram");
        return;
      }
      if (!value) {
        setError(mode === "story" ? "Describe your story idea first." : "Paste a link first.");
        return;
      }
      if (mode === "script") {
        router.push(`/dashboard/new?url=${encodeURIComponent(value)}`);
        return;
      }
      if (mode === "clips") {
        if (!isYouTube(value)) {
          setError("Paste a YouTube video link, or use Upload for a file.");
          return;
        }
        if (!rights) {
          setError("Please confirm you own this video or have permission to use it.");
          return;
        }
        setBusy(true);
        await createFromUrl({ url: value, rightsConfirmed: true });
        router.push("/dashboard/clips");
        return;
      }
      // story
      setBusy(true);
      const id = await createStory({
        idea: value,
        aspect: "9:16",
        targetSec: 60,
        style: "cinematic",
        narratorVoice: "onyx",
      });
      router.push(`/dashboard/stories/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      // Convex wraps server errors: "[CONVEX M(...)] ... Uncaught Error: <msg>"
      setError(msg.match(/Uncaught Error: (.*?)(\n|$)/)?.[1] ?? msg);
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="grid w-full max-w-[720px] gap-2.5 rounded-[16px] border border-line-strong bg-surface p-2.5 text-left shadow-[0_20px_50px_-25px_rgba(0,0,0,0.9)] focus-within:border-neutral-600"
    >
      <div className="flex items-center gap-2.5 py-1 pl-2 pr-1">
        <Link2 size={16} className="flex-shrink-0 text-faint" />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          disabled={busy}
          placeholder={ph}
          aria-label={mode === "story" ? "Story idea" : "Video link"}
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-faint sm:text-[15px]"
        />
        <Button asChild variant="ghost" size="sm" title="Upload a file" className="px-2 sm:px-3">
          <Link href="/dashboard/clips">
            <Upload size={15} />
            <span className="max-sm:hidden">Upload</span>
          </Link>
        </Button>
        <Button type="submit" size="sm" aria-label="Start" disabled={busy} className="w-8 px-0">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
        </Button>
      </div>

      {ytLink && (
        <label className="flex items-start gap-2 px-2 text-[13px] text-muted">
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => {
              setRights(e.target.checked);
              setError(null);
            }}
            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--color-accent)]"
          />
          <span>I own this video or have permission to use it.</span>
        </label>
      )}

      {error && <p className="px-2 text-[13px] text-bad">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2.5 px-1 pt-0.5">
        <div role="group" aria-label="What to make" className="flex flex-wrap gap-1">
          {MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => {
                setMode(key);
                setError(null);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition",
                mode === key
                  ? "border-line-strong bg-surface-3 text-fg"
                  : "border-transparent text-muted hover:bg-surface-2 hover:text-fg"
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-faint max-sm:hidden">Press Enter to start</span>
      </div>
    </form>
  );
}

// ── tools ──

function Thumb({ i, className }: { i: number; className?: string }) {
  return <div className={className} style={{ background: GRADIENTS[i - 1] }} />;
}

const TOOLS = [
  {
    href: "/dashboard/new",
    title: "Rewrite a video",
    desc: "Get a script with the same structure",
    vis: (
      <div className="grid w-[76%] gap-1.5">
        <div className="h-[7px] w-[90%] rounded bg-surface-3" />
        <div className="h-[7px] w-[70%] rounded bg-accent-soft outline outline-1 outline-accent/35" />
        <div className="h-[7px] w-[82%] rounded bg-surface-3" />
        <div className="h-[7px] w-1/2 rounded bg-surface-3" />
      </div>
    ),
  },
  {
    href: "/dashboard/clips",
    title: "Cut clips",
    desc: "Best moments, reframed to 9:16",
    vis: (
      <div className="flex items-end gap-1.5">
        <Thumb i={2} className="aspect-[9/16] w-[34px] rounded-[5px]" />
        <Thumb i={4} className="aspect-[9/16] w-[42px] rounded-[5px]" />
        <Thumb i={6} className="aspect-[9/16] w-[34px] rounded-[5px]" />
      </div>
    ),
  },
  {
    href: "/dashboard/stories",
    title: "Story video",
    badge: "New",
    desc: "Narrated scenes from a script",
    vis: (
      <div className="grid grid-cols-[repeat(3,26px)] gap-1">
        {[7, 3, 5, 6, 1, 8].map((n) => (
          <Thumb key={n} i={n} className="aspect-square rounded" />
        ))}
      </div>
    ),
  },
  {
    href: "/dashboard/instagram",
    title: "Instagram carousel",
    desc: "Slides and caption from one idea",
    vis: (
      <div className="flex gap-1">
        {[8, 3, 4].map((n) => (
          <Thumb key={n} i={n} className="aspect-[4/5] w-[44px] rounded-[5px]" />
        ))}
      </div>
    ),
  },
];

function Tools() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
      {TOOLS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="grid min-w-0 grid-rows-[84px_auto] overflow-hidden rounded-[12px] border border-line bg-surface transition hover:-translate-y-px hover:border-line-strong sm:grid-rows-[112px_auto]"
        >
          <div className="relative grid place-items-center overflow-hidden border-b border-line bg-surface-2">{t.vis}</div>
          <div className="grid gap-0.5 px-3.5 pb-3.5 pt-3">
            <b className="flex items-center gap-2 text-sm font-semibold">
              {t.title}
              {t.badge && (
                <span className="rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-accent">
                  {t.badge}
                </span>
              )}
            </b>
            <span className="text-[13px] text-faint max-sm:hidden">{t.desc}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ── item visuals ──

function ItemThumb({ item, className, children }: { item: HomeItem; className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn("relative overflow-hidden bg-surface-2", className)}
      style={item.thumbUrl ? undefined : { background: gradientFor(item.id) }}
    >
      {item.thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumbUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {children}
      {fmtDur(item.durationSec) && (
        <span className="absolute bottom-2 right-2 z-[2] rounded bg-black/55 px-1.5 py-px font-mono text-[11px] text-white">
          {fmtDur(item.durationSec)}
        </span>
      )}
    </div>
  );
}

function StateOverlay({ item }: { item: HomeItem }) {
  if (item.state === "ready") return null;
  return (
    <div className="absolute inset-0 z-[3] grid place-items-center bg-[rgba(5,5,6,0.62)] px-2 text-center text-[13px] font-semibold">
      {item.state === "processing" ? (
        <div className="grid w-[60%] justify-items-center gap-2">
          <span className="shimmer">{item.stateLabel ?? "Processing"}…</span>
          {item.progress != null && <Bar value={item.progress} className="w-full" />}
        </div>
      ) : item.state === "failed" ? (
        <span className="text-bad">{item.stateLabel ?? "Failed"}</span>
      ) : (
        <span className="text-accent">{item.stateLabel}</span>
      )}
    </div>
  );
}

function Continue({ item }: { item: HomeItem }) {
  const k = KIND[item.kind];
  return (
    <Link
      href={k.href(item.id)}
      className="grid grid-cols-1 items-center gap-5 rounded-[18px] border border-line bg-surface p-3.5 transition hover:border-line-strong sm:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_auto]"
    >
      <ItemThumb item={item} className="aspect-video rounded-[10px]">
        <StateOverlay item={item} />
      </ItemThumb>
      <div className="min-w-0">
        <h3 className="mb-1 truncate text-lg font-semibold">{item.title}</h3>
        <p className="mb-2.5 text-[13px] text-faint">
          {k.label} · {item.sub} · edited {timeAgo(item.updatedAt)}
        </p>
        {item.excerpt && (
          <blockquote className="line-clamp-2 border-l-2 border-line-strong pl-3 text-sm text-muted">{item.excerpt}</blockquote>
        )}
      </div>
      <span className="inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[13px] font-semibold text-muted max-lg:hidden">
        Open <ArrowRight size={14} />
      </span>
    </Link>
  );
}

function Card({ item }: { item: HomeItem }) {
  const k = KIND[item.kind];
  const Icon = k.icon;
  return (
    <Link href={k.href(item.id)} className="group grid min-w-0 gap-2.5">
      <ItemThumb item={item} className="aspect-[16/10] rounded-[10px] border border-line transition group-hover:border-line-strong">
        <span className="absolute left-2 top-2 z-[2] inline-flex items-center gap-1 rounded-md bg-black/50 px-[7px] py-[3px] text-[11px] font-semibold text-white backdrop-blur-[6px]">
          <Icon size={12} />
          {k.label}
        </span>
        <StateOverlay item={item} />
      </ItemThumb>
      <div className="min-w-0">
        <h4 className="truncate text-sm font-semibold">{item.title}</h4>
        <p className="mt-px truncate text-xs text-faint">
          {item.sub} · {timeAgo(item.updatedAt)}
        </p>
      </div>
    </Link>
  );
}

// ── page ──

type Filter = "all" | HomeKind;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "script", label: "Scripts" },
  { key: "clip", label: "Clips" },
  { key: "story", label: "Stories" },
];

function BlockHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const [since] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const recent = useQuery(api.home.recent, { limit: 16 });
  const stats = useQuery(api.home.monthStats, { since });
  const [filter, setFilter] = useState<Filter>("all");

  const items = recent ?? [];
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const latest = items[0];

  const statItems = stats
    ? [
        { k: "Projects", v: stats.projects.toLocaleString() },
        { k: "Minutes transcribed", v: stats.minutesTranscribed.toLocaleString() },
        { k: "Clip videos", v: stats.clipVideos.toLocaleString() },
        { k: "Clips exported", v: stats.clipsExported.toLocaleString() },
        { k: "Stories", v: stats.stories.toLocaleString() },
      ]
    : null;

  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-9 pb-6">
      <section className="grid justify-items-center gap-[18px] pb-2 pt-3 text-center sm:pt-7">
        <h1 className="text-[26px] font-semibold tracking-tight sm:text-[34px]" suppressHydrationWarning>
          {greeting()}. What are we making?
        </h1>
        <CommandBar />
      </section>

      <section>
        <BlockHead title="Start something" />
        <Tools />
      </section>

      {latest && (
        <section>
          <BlockHead title="Continue where you left off" />
          <Continue item={latest} />
        </section>
      )}

      <section>
        <BlockHead title="This month" />
        {statItems ? (
          <StatRow
            items={statItems}
            className="max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:max-lg:[&>*:nth-child(4)]:border-l-0! sm:max-lg:[&>*:nth-child(n+4)]:border-t"
          />
        ) : (
          <div className="h-[86px] animate-pulse rounded-[12px] border border-line bg-surface" />
        )}
      </section>

      <section>
        <BlockHead title="Recent">
          <div role="group" aria-label="Filter recent work" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full border px-[11px] py-[5px] text-[13px] transition",
                  filter === f.key ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </BlockHead>

        {recent === undefined ? (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-faint" size={20} />
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-line py-14 text-center">
            <p className="mb-1 text-muted">{filter === "all" ? "Nothing here yet" : `No ${FILTERS.find((f) => f.key === filter)!.label.toLowerCase()} yet`}</p>
            <p className="text-sm text-faint">Paste a link above or pick a tool to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {shown.map((item) => (
              <Card key={`${item.kind}:${item.id}`} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
