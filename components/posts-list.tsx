"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, Tone } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

// Everything posted (or scheduled) from VidoScript, with live status and stats.
// Shown on the Socials page ("Posted from VidoScript" tab).

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
const fmt = (n: number | undefined) => (n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());
const when = (t: number) =>
  new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function PostsList() {
  const posts = useQuery(api.social.posts);
  const retry = useMutation(api.social.retryPost);
  const cancel = useMutation(api.social.cancelPost);

  const live = (posts ?? []).filter((p) => p.status === "published");
  const total = (k: "views" | "likes" | "comments" | "shares") => live.reduce((s, p) => s + (p.stats?.[k] ?? 0), 0);

  return (
    <div className="grid gap-5">
      {live.length > 0 && (
        <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-line sm:grid-cols-4">
          {(["views", "likes", "comments", "shares"] as const).map((k, i) => (
            <div key={k} className={cn("grid gap-0.5 px-4 py-3", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line sm:border-t-0", i === 2 && "sm:border-l")}>
              <span className="text-xs capitalize text-faint">{k}</span>
              <span className="text-xl font-semibold tabular">{fmt(total(k))}</span>
            </div>
          ))}
        </div>
      )}

      {posts === undefined ? (
        <Loader2 className="animate-spin text-faint" />
      ) : posts === null || posts.length === 0 ? (
        <Panel>
          <PanelBody className="grid gap-2 text-sm text-muted">
            <p>Nothing posted yet. Use the Post button on a finished story or clip.</p>
            <p>
              <Link href="/dashboard/settings#connected-accounts" className="text-fg underline">
                Connect your accounts
              </Link>{" "}
              first.
            </p>
          </PanelBody>
        </Panel>
      ) : (
        <ul className="grid gap-2">
          {posts.map((p) => (
            <li key={p._id} className="grid gap-2 rounded-[12px] border border-line bg-surface p-3 sm:p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{p.title}</span>
                <Tone tone="muted">{PLATFORM_LABEL[p.platform] ?? p.platform}</Tone>
                <span className="text-xs text-faint">@{p.handle}</span>
                <span className="ml-auto">
                  {p.status === "published" ? (
                    <Tone tone="ok">Live</Tone>
                  ) : p.status === "failed" ? (
                    <Tone tone="bad">Failed</Tone>
                  ) : p.status === "scheduled" ? (
                    <Tone tone="muted">Scheduled {p.scheduledAt ? when(p.scheduledAt) : ""}</Tone>
                  ) : (
                    <Tone tone="warn">Posting</Tone>
                  )}
                </span>
              </div>
              {(p.status === "posting" || p.status === "queued") && (
                <p className="flex items-center gap-1.5 text-xs text-accent">
                  <Loader2 size={12} className="animate-spin" /> {p.step ?? "Waiting to post…"}
                </p>
              )}
              {p.status === "failed" && p.error && <p className="text-xs text-bad">{p.error}</p>}
              {p.status === "published" && p.error && <p className="text-xs text-accent">{p.error}</p>}
              {p.status === "published" && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted">
                  <span>{fmt(p.stats?.views)} views</span>
                  <span>{fmt(p.stats?.likes)} likes</span>
                  <span>{fmt(p.stats?.comments)} comments</span>
                  <span>{fmt(p.stats?.shares)} shares</span>
                  {p.stats?.saves != null && <span>{fmt(p.stats.saves)} saves</span>}
                  {p.stats?.avgWatchSec != null && <span>{p.stats.avgWatchSec.toFixed(1)}s avg watch</span>}
                  <span className="text-faint">{p.statsAt ? `updated ${when(p.statsAt)}` : "first stats within the hour"}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                <span>{p.publishedAt ? `Posted ${when(p.publishedAt)}` : `Created ${when(p.createdAt)}`}</span>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-fg">
                    Open <ExternalLink size={11} />
                  </a>
                )}
                <span className="ml-auto flex gap-1.5">
                  {p.status === "failed" && (
                    <Button size="sm" variant="outline" onClick={() => retry({ postId: p._id })}>
                      <RefreshCw size={12} /> Retry
                    </Button>
                  )}
                  {(p.status === "failed" || p.status === "scheduled") && (
                    <Button size="sm" variant="ghost" onClick={() => cancel({ postId: p._id })}>
                      <Trash2 size={12} /> {p.status === "scheduled" ? "Cancel" : "Remove"}
                    </Button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
