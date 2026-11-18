"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { CalendarClock, Check, ExternalLink, Loader2, Send, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Switch, Tone } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

// "Post" for a finished story or clip: pick connected accounts, edit the copy
// per platform, post now or schedule. Publishing runs in convex/socialNode.ts.

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram Reels", youtube: "YouTube Shorts", tiktok: "TikTok" };
const CAPTION_MAX: Record<string, number> = { instagram: 2200, youtube: 5000, tiktok: 2200 };

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));

type TikTokOpts = { allowComment: boolean; allowDuet: boolean; allowStitch: boolean; disclose: boolean; brandOrganic: boolean; brandContent: boolean };
type Target = {
  on: boolean;
  title: string;
  caption: string;
  aiLabel: boolean;
  privacy: string; // YouTube: public | unlisted | private · TikTok: chosen each time ("" = not chosen)
  tt: TikTokOpts;
};

// TikTok's posting rules: interaction toggles start off; privacy has no default.
const TT_DEFAULT: TikTokOpts = { allowComment: false, allowDuet: false, allowStitch: false, disclose: false, brandOrganic: false, brandContent: false };
const TT_PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

type CreatorInfo = {
  nickname: string;
  avatarUrl: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec: number;
};

// A switch with its label visible (the kit Switch's label is for screen readers).
function LabeledSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <Switch checked={checked} onChange={onChange} label={label} />
      <span>{label}</span>
    </span>
  );
}

// TikTok settings for one post: shown exactly as TikTok's Direct Post rules ask.
function TikTokFields({ accountId, t, set }: { accountId: Id<"socialAccounts">; t: Target; set: (p: Partial<Target>) => void }) {
  const load = useAction(api.socialNode.tiktokCreatorInfo);
  const [info, setInfo] = useState<CreatorInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load({ accountId }).then(setInfo, (e) => setError(errText(e)));
  }, [accountId, load]);
  const tt = t.tt;
  const setTT = (p: Partial<TikTokOpts>) => set({ tt: { ...tt, ...p } });
  if (error) return <p className="text-xs text-bad">{error}</p>;
  if (!info) return <Loader2 size={14} className="animate-spin text-faint" />;
  const box = "flex items-center gap-2 text-xs text-muted";
  return (
    <div className="grid gap-2 rounded-[10px] border border-line p-2.5">
      <span className="text-xs text-faint">Posting to TikTok as {info.nickname}</span>
      <select
        aria-label="Who can see this TikTok"
        value={t.privacy}
        onChange={(e) => set({ privacy: e.target.value })}
        className="h-9 rounded-[10px] border border-line bg-bg px-2.5 text-base text-fg outline-none focus:border-line-strong sm:text-sm"
      >
        <option value="" disabled>
          Who can see this? (choose one)
        </option>
        {info.privacyOptions.map((o) => (
          <option key={o} value={o} disabled={o === "SELF_ONLY" && tt.brandContent} title={o === "SELF_ONLY" && tt.brandContent ? "Branded content can't be private" : undefined}>
            {TT_PRIVACY[o] ?? o}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <label className={cn(box, info.commentDisabled && "opacity-40")}>
          <input type="checkbox" disabled={info.commentDisabled} checked={tt.allowComment && !info.commentDisabled} onChange={(e) => setTT({ allowComment: e.target.checked })} /> Allow comments
        </label>
        <label className={cn(box, info.duetDisabled && "opacity-40")}>
          <input type="checkbox" disabled={info.duetDisabled} checked={tt.allowDuet && !info.duetDisabled} onChange={(e) => setTT({ allowDuet: e.target.checked })} /> Allow Duet
        </label>
        <label className={cn(box, info.stitchDisabled && "opacity-40")}>
          <input type="checkbox" disabled={info.stitchDisabled} checked={tt.allowStitch && !info.stitchDisabled} onChange={(e) => setTT({ allowStitch: e.target.checked })} /> Allow Stitch
        </label>
      </div>
      <LabeledSwitch
        checked={tt.disclose}
        onChange={(v) => setTT({ disclose: v, ...(v ? {} : { brandOrganic: false, brandContent: false }) })}
        label="Disclose commercial content (this promotes a brand, product or service)"
      />
      {tt.disclose && (
        <div className="grid gap-1.5 pl-1">
          <label className={box}>
            <input type="checkbox" checked={tt.brandOrganic} onChange={(e) => setTT({ brandOrganic: e.target.checked })} /> Your brand: you&apos;re promoting yourself or your own business
          </label>
          <label className={box}>
            <input
              type="checkbox"
              checked={tt.brandContent}
              onChange={(e) => {
                setTT({ brandContent: e.target.checked });
                if (e.target.checked && t.privacy === "SELF_ONLY") set({ privacy: "", tt: { ...tt, brandContent: true } });
              }}
            />{" "}
            Branded content: you&apos;re promoting another brand or a third party
          </label>
          {!tt.brandOrganic && !tt.brandContent && <span className="text-xs text-accent">Choose at least one, or turn disclosure off.</span>}
          {(tt.brandOrganic || tt.brandContent) && (
            <span className="text-xs text-faint">
              Your video will be labelled &quot;{tt.brandContent ? "Paid partnership" : "Promotional content"}&quot;.
            </span>
          )}
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-faint">
        By posting, you agree to TikTok&apos;s{" "}
        {tt.brandContent && (
          <>
            <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="underline">
              Branded Content Policy
            </a>{" "}
            and{" "}
          </>
        )}
        <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="underline">
          Music Usage Confirmation
        </a>
        . It may take a few minutes to appear on your profile.
      </p>
    </div>
  );
}

export function PostButton({
  sourceType,
  sourceId,
  aiGenerated = false,
  size = "default",
}: {
  sourceType: "story" | "clip";
  sourceId: string;
  aiGenerated?: boolean;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <Send size={size === "sm" ? 13 : 15} /> Post
      </Button>
      {open && <PostDialog sourceType={sourceType} sourceId={sourceId} aiGenerated={aiGenerated} onClose={() => setOpen(false)} />}
    </>
  );
}

function PostDialog({
  sourceType,
  sourceId,
  aiGenerated,
  onClose,
}: {
  sourceType: "story" | "clip";
  sourceId: string;
  aiGenerated: boolean;
  onClose: () => void;
}) {
  const data = useQuery(api.social.accounts);
  const draft = useQuery(api.social.draft, { sourceType, sourceId });
  const createPosts = useMutation(api.social.createPosts);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const accounts = (data?.accounts ?? []).filter((a) => a.status === "active");

  // Prefill each account once the draft arrives.
  useEffect(() => {
    if (!draft) return;
    setTargets((t) => {
      const next = { ...t };
      for (const a of accounts) {
        if (!next[a._id])
          next[a._id] = { on: false, title: draft.title, caption: draft.caption, aiLabel: aiGenerated, privacy: a.platform === "tiktok" ? "" : "public", tt: TT_DEFAULT };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.title, draft?.caption, accounts.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = accounts.filter((a) => targets[a._id]?.on);
  const set = (id: string, patch: Partial<Target>) => setTargets((t) => ({ ...t, [id]: { ...t[id], ...patch } }));

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const scheduledAt = when === "later" && at ? new Date(at).getTime() : undefined;
      if (when === "later" && (!scheduledAt || scheduledAt < Date.now() + 60_000)) throw new Error("Pick a time in the future.");
      for (const a of chosen) {
        const t = targets[a._id];
        if (a.platform === "tiktok" && !t.privacy) throw new Error("Choose who can see the TikTok post.");
        if (a.platform === "tiktok" && t.tt.disclose && !t.tt.brandOrganic && !t.tt.brandContent) {
          throw new Error("For commercial content, choose Your brand and/or Branded content.");
        }
      }
      await createPosts({
        sourceType,
        sourceId,
        scheduledAt,
        targets: chosen.map((a) => ({
          accountId: a._id as Id<"socialAccounts">,
          title: targets[a._id].title,
          caption: targets[a._id].caption,
          aiLabel: targets[a._id].aiLabel,
          privacy: a.platform === "instagram" ? undefined : targets[a._id].privacy,
          tiktok:
            a.platform === "tiktok"
              ? {
                  disableComment: !targets[a._id].tt.allowComment,
                  disableDuet: !targets[a._id].tt.allowDuet,
                  disableStitch: !targets[a._id].tt.allowStitch,
                  brandOrganic: targets[a._id].tt.brandOrganic,
                  brandContent: targets[a._id].tt.brandContent,
                }
              : undefined,
        })),
      });
      setDone(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 sm:place-items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Post video"
        onClick={(e) => e.stopPropagation()}
        className="grid max-h-[92dvh] w-full gap-4 overflow-y-auto rounded-t-[16px] border border-line bg-bg p-4 sm:max-w-xl sm:rounded-[16px] sm:p-5"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Post video</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <X size={18} />
          </button>
        </div>

        {data === undefined || draft === undefined ? (
          <Loader2 className="animate-spin text-faint" />
        ) : !draft ? (
          <p className="text-sm text-muted">Not found.</p>
        ) : !draft.ready ? (
          <p className="text-sm text-muted">Export the video first, then post it.</p>
        ) : done ? (
          <div className="grid gap-3">
            <p className="flex items-center gap-2 text-sm text-ok">
              <Check size={16} /> {when === "later" ? "Scheduled." : "Posting now. It takes a minute or two."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/socials?tab=posted">
                <Button size="sm">See posts</Button>
              </Link>
              <Button size="sm" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted">Connect an account first.</p>
            <Link href="/dashboard/settings#connected-accounts">
              <Button size="sm">Connect accounts</Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-2">
              {accounts.map((a) => {
                const t = targets[a._id];
                if (!t) return null;
                const max = CAPTION_MAX[a.platform] ?? 2200;
                return (
                  <div key={a._id} className={cn("grid gap-2.5 rounded-[12px] border p-3", t.on ? "border-line-strong bg-surface" : "border-line")}>
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input type="checkbox" checked={t.on} onChange={(e) => set(a._id, { on: e.target.checked })} className="accent-[var(--color-fg)]" />
                      {a.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.avatarUrl} alt="" className="h-6 w-6 rounded-full" />
                      ) : null}
                      <span className="text-sm font-medium">@{a.handle}</span>
                      <Tone tone="muted">{PLATFORM_LABEL[a.platform] ?? a.platform}</Tone>
                    </label>
                    {t.on && (
                      <div className="grid gap-2">
                        {a.platform === "youtube" && (
                          <select
                            aria-label="Who can watch"
                            value={t.privacy}
                            onChange={(e) => set(a._id, { privacy: e.target.value })}
                            className="h-9 rounded-[10px] border border-line bg-bg px-2.5 text-base text-fg outline-none focus:border-line-strong sm:text-sm"
                          >
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                          </select>
                        )}
                        {a.platform === "youtube" && (
                          <input
                            aria-label="Title"
                            value={t.title}
                            maxLength={100}
                            onChange={(e) => set(a._id, { title: e.target.value })}
                            placeholder="Title"
                            className="w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-base text-fg outline-none focus:border-line-strong sm:text-sm"
                          />
                        )}
                        {a.platform === "tiktok" && <TikTokFields accountId={a._id as Id<"socialAccounts">} t={t} set={(p) => set(a._id, p)} />}
                        <textarea
                          aria-label="Caption"
                          value={t.caption}
                          maxLength={max}
                          onChange={(e) => set(a._id, { caption: e.target.value })}
                          rows={4}
                          className="w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-base text-fg outline-none focus:border-line-strong sm:text-sm"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
                          <LabeledSwitch
                            checked={t.aiLabel}
                            onChange={(v) => set(a._id, { aiLabel: v })}
                            label="Made with AI (labelled where the platform supports it)"
                          />
                          <span className="font-mono">
                            {t.caption.length}/{max}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(["now", "later"] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setWhen(w)}
                    aria-pressed={when === w}
                    className={cn(
                      "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
                      when === w ? "border-fg bg-surface-3 text-fg" : "border-line-strong text-muted hover:text-fg"
                    )}
                  >
                    {w === "now" ? <Send size={12} /> : <CalendarClock size={12} />} {w === "now" ? "Post now" : "Schedule"}
                  </button>
                ))}
              </div>
              {when === "later" && (
                <input
                  type="datetime-local"
                  aria-label="Post at"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  className="h-10 rounded-[10px] border border-line bg-bg px-3 text-base text-fg outline-none focus:border-line-strong sm:text-sm"
                />
              )}
            </div>

            {error && <p className="text-xs text-bad">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || chosen.length === 0} onClick={submit}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {when === "later" ? "Schedule" : "Post"} to {chosen.length || ""} account{chosen.length === 1 ? "" : "s"}
              </Button>
              <Link href="/dashboard/settings#connected-accounts" className="text-xs text-faint hover:text-fg">
                Manage accounts
              </Link>
            </div>
          </>
        )}

        {draft && draft.posts.length > 0 && !done && (
          <div className="grid gap-1.5 border-t border-line pt-3">
            <span className="text-xs text-faint">Already posted</span>
            {draft.posts.map((p) => (
              <div key={p._id} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">
                  {PLATFORM_LABEL[p.platform] ?? p.platform} · {p.status}
                  {p.stats?.views != null ? ` · ${p.stats.views.toLocaleString()} views` : ""}
                </span>
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-faint hover:text-fg">
                    Open <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
