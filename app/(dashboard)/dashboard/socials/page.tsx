"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Chip, Panel, PanelBody, Segmented, Tone } from "@/components/ui/kit";
import { PostsList } from "@/components/posts-list";
import { cn } from "@/lib/utils";

// Socials: the connected accounts (Instagram, YouTube, TikTok), their latest
// videos with stats, and everything posted from VidoScript.

const PLATFORM: Record<string, { label: string; followers: string }> = {
  instagram: { label: "Instagram", followers: "followers" },
  youtube: { label: "YouTube", followers: "subscribers" },
  tiktok: { label: "TikTok", followers: "followers" },
};
const fmt = (n: number | undefined | null) =>
  n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString();
const ago = (t: number) => {
  const h = (Date.now() - t) / 3_600_000;
  return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : h < 24 * 30 ? `${Math.round(h / 24)}d ago` : new Date(t).toLocaleDateString();
};

export default function SocialsPage() {
  const data = useQuery(api.social.overview);
  const sync = useAction(api.socialNode.syncAccounts);
  const [tab, setTab] = useState<"videos" | "posted">("videos");
  const [only, setOnly] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "posted") setTab("posted");
  }, []);

  // Refresh on open (the server skips accounts synced in the last 15 min).
  useEffect(() => {
    setSyncing(true);
    sync({}).finally(() => setSyncing(false));
  }, [sync]);

  const accounts = data ?? [];
  const videos = useMemo(
    () =>
      accounts
        .filter((a) => !only || a._id === only)
        .flatMap((a) => a.media.map((m) => ({ ...m, handle: a.handle, platform: a.platform })))
        .sort((a, b) => b.publishedAt - a.publishedAt),
    [accounts, only]
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">Socials</h1>
          <p className="mt-1 text-sm text-muted">Your Instagram, YouTube and TikTok in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              sync({ force: true }).finally(() => setSyncing(false));
            }}
          >
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </Button>
          <Link href="/dashboard/settings#connected-accounts">
            <Button variant="ghost">
              <Plus size={15} /> Accounts
            </Button>
          </Link>
        </div>
      </div>

      {data === undefined ? (
        <Loader2 className="animate-spin text-faint" />
      ) : accounts.length === 0 ? (
        <Panel>
          <PanelBody className="grid justify-items-start gap-3 text-sm text-muted">
            <p>No accounts connected yet.</p>
            <Link href="/dashboard/settings#connected-accounts">
              <Button size="sm">Connect Instagram, YouTube or TikTok</Button>
            </Link>
          </PanelBody>
        </Panel>
      ) : (
        <>
          {/* Account cards */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => {
              const p = PLATFORM[a.platform] ?? { label: a.platform, followers: "followers" };
              const views = a.profile?.totalViews ?? a.media.reduce((s, m) => s + (m.views ?? 0), 0);
              return (
                <li key={a._id}>
                  <button
                    type="button"
                    onClick={() => setOnly(only === a._id ? null : a._id)}
                    aria-pressed={only === a._id}
                    className={cn(
                      "grid w-full gap-3 rounded-[12px] border bg-surface p-3.5 text-left transition",
                      only === a._id ? "border-fg" : "border-line hover:border-line-strong"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {a.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.avatarUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded-full bg-surface-2" />
                      ) : (
                        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-surface-2 text-sm">{a.handle.slice(0, 1).toUpperCase()}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">@{a.handle}</div>
                        <div className="text-xs text-faint">{p.label}</div>
                      </div>
                      {a.status !== "active" ? <Tone tone="bad">Reconnect</Tone> : a.syncError ? <Tone tone="warn">Sync issue</Tone> : null}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-lg font-semibold tabular">{fmt(a.profile?.followers)}</div>
                        <div className="text-[11px] text-faint">{p.followers}</div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold tabular">{fmt(views || null)}</div>
                        <div className="text-[11px] text-faint">{a.platform === "youtube" ? "total views" : "recent views"}</div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold tabular">{fmt(a.profile?.videoCount ?? a.media.length)}</div>
                        <div className="text-[11px] text-faint">{a.platform === "instagram" ? "posts" : "videos"}</div>
                      </div>
                    </div>
                    {a.profile?.totalLikes != null && (
                      <span className="text-xs text-muted">{fmt(a.profile.totalLikes)} likes across all videos</span>
                    )}
                    {a.syncError && <p className="line-clamp-2 text-[11px] text-accent">{a.syncError}</p>}
                    <span className="text-[11px] text-faint">{a.syncedAt ? `Updated ${ago(a.syncedAt)}` : "Not synced yet"}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              label="Show"
              value={tab}
              onChange={(t) => setTab(t as "videos" | "posted")}
              options={[
                { value: "videos", label: "Latest videos" },
                { value: "posted", label: "Posted from VidoScript" },
              ]}
            />
            {tab === "videos" && only && (
              <Chip pressed onClick={() => setOnly(null)}>
                Showing one account · show all
              </Chip>
            )}
          </div>

          {tab === "posted" ? (
            <PostsList />
          ) : videos.length === 0 ? (
            <p className="text-sm text-faint">{syncing ? "Loading your videos…" : "No videos yet."}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {videos.map((v) => (
                <li key={`${v.accountId}-${v.externalId}`} className="grid content-start overflow-hidden rounded-[12px] border border-line bg-surface">
                  <a href={v.url ?? "#"} target="_blank" rel="noreferrer" className="relative block aspect-[9/14] bg-surface-2">
                    {v.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    ) : null}
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 text-[10px] text-white">
                      {PLATFORM[v.platform]?.label ?? v.platform}
                    </span>
                    {v.fromApp && (
                      <span className="absolute right-1.5 top-1.5 rounded bg-accent px-1.5 text-[10px] font-semibold text-bg">via VidoScript</span>
                    )}
                  </a>
                  <div className="grid gap-1 p-2.5">
                    <p className="line-clamp-2 text-[13px] leading-snug text-fg">{v.title || <i className="text-faint">No caption</i>}</p>
                    <div className="flex flex-wrap gap-x-2.5 font-mono text-[11px] text-muted">
                      {v.views != null && <span>{fmt(v.views)} views</span>}
                      {v.likes != null && <span>{fmt(v.likes)} likes</span>}
                      {v.comments != null && <span>{fmt(v.comments)} comments</span>}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
                      <span className="truncate">
                        @{v.handle} · {ago(v.publishedAt)}
                        {v.kind && v.kind !== "video" ? ` · ${v.kind}` : ""}
                      </span>
                      {v.url && (
                        <a href={v.url} target="_blank" rel="noreferrer" aria-label="Open" className="hover:text-fg">
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tab === "videos" && accounts.some((a) => a.platform === "tiktok" && a.profile?.followers == null) && (
            <p className="text-[11px] text-faint">
              TikTok followers appear after you add the user.info.stats scope to your TikTok app and reconnect TikTok.
            </p>
          )}
        </>
      )}
    </div>
  );
}
