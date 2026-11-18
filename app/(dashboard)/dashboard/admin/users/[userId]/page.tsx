"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Panel, PanelHeader, StatRow, Tone } from "@/components/ui/kit";
import { Dot, Initials, Note, Status, Table, ago, clock, duration, usd } from "../../_components/bits";
import { useUserProfiles } from "../../_components/use-user-profiles";

export default function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const data = useQuery(api.admin.userDetail, { userId });
  const profile = useUserProfiles([userId])[userId];

  if (data === undefined) return <Loader2 className="animate-spin text-faint" />;

  const name = profile?.name ?? profile?.email ?? userId;
  const failed = data.renders.filter((r) => r.status === "failed").length;
  const titles = new Map(data.projects.map((p) => [p.id as string, p.title]));
  const lastActive = Math.max(
    0,
    ...data.projects.map((p) => p.updatedAt),
    ...data.renders.map((r) => r.updatedAt),
    ...data.library.map((l) => l.createdAt),
    ...data.ai.recent.map((u) => u.createdAt)
  );

  // Projects and renders in one list, newest first.
  const items = [
    ...data.projects.map((p) => ({
      key: `p-${p.id}`,
      title: p.title,
      sub: null as string | null,
      type: "Project",
      status: p.status,
      error: p.error,
      duration: "—",
      updatedAt: p.updatedAt,
    })),
    ...data.renders.map((r) => ({
      key: `r-${r.id}`,
      title: titles.get(r.projectId as string) ?? "Render",
      sub: r.id as string,
      type: "Render",
      status: r.status,
      error: r.error ?? null,
      duration: r.startedAt && r.finishedAt ? duration((r.finishedAt - r.startedAt) / 1000) : "—",
      updatedAt: r.updatedAt,
    })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Link href="/dashboard/admin/users" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-faint hover:text-fg">
        <ArrowLeft size={14} /> Users
      </Link>

      <div className="flex flex-wrap items-center gap-3.5">
        <Initials id={userId} text={name} size={48} />
        <div className="min-w-0">
          <h2 className="break-words text-[22px] font-semibold">{name}</h2>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-faint">
            {profile?.email && profile.name && <span className="break-all">{profile.email} ·</span>}
            <span className="max-w-full truncate rounded-md border border-line px-1.5 py-px font-mono text-xs">{userId}</span>
          </p>
        </div>
        {failed > 0 && (
          <Tone tone="bad" className="sm:ml-auto">
            {failed} failed render{failed === 1 ? "" : "s"}
          </Tone>
        )}
      </div>

      <StatRow
        items={[
          { k: "Projects", v: data.projects.length },
          { k: "Renders", v: data.renders.length },
          { k: "Library items", v: data.library.length },
          { k: "AI cost", v: usd(data.ai.costUsd), d: `${data.ai.calls} calls`, flat: true },
          { k: "Last active", v: lastActive ? ago(lastActive).replace(" ago", "") : "—", d: lastActive ? "ago" : undefined, flat: true },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Projects and renders">
            <Note>Latest 50 each</Note>
          </PanelHeader>
          <Table
            cols={[
              { label: "Item" },
              { label: "Type" },
              { label: "Status" },
              { label: "Duration", num: true },
              { label: "Updated", num: true },
            ]}
            empty="No projects or renders."
            rows={items.map((it) => ({
              key: it.key,
              cells: [
                <div key="t" className="min-w-0">
                  <div className="text-fg">{it.title}</div>
                  {it.sub && <div className="font-mono text-[11px] text-faint">{it.sub}</div>}
                  {it.error && <div className="break-all font-mono text-[11px] text-bad">{it.error}</div>}
                </div>,
                it.type,
                <Status key="s" s={it.status} />,
                <span key="d" className="font-mono">{it.duration}</span>,
                ago(it.updatedAt),
              ],
            }))}
          />
        </Panel>

        <Panel>
          <PanelHeader title="Recent AI calls" />
          {data.ai.recent.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-faint">No AI calls.</div>
          ) : (
            <ul className="grid">
              {data.ai.recent.map((u, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[44px_12px_minmax(0,1fr)] items-start gap-2.5 border-t border-line px-4 py-[9px] text-[13px] first:border-t-0"
                >
                  <time className="pt-0.5 font-mono text-[11px] text-faint" title={new Date(u.createdAt).toLocaleString()}>
                    {Date.now() - u.createdAt < 86400_000 ? clock(u.createdAt) : ago(u.createdAt).replace(" ago", "")}
                  </time>
                  <Dot className="mt-[5px]" />
                  <div className="min-w-0">
                    {u.feature}
                    <small className="block break-all font-mono text-xs text-faint">
                      {u.model} · {usd(u.costUsd)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Library">
          <Note>Latest 50</Note>
        </PanelHeader>
        <Table
          cols={[{ label: "Item" }, { label: "Status" }, { label: "Added", num: true }]}
          empty="No library items."
          rows={data.library.map((l) => ({
            key: l.id as string,
            cells: [
              <div key="l" className="min-w-0">
                <div className="text-fg">{l.creatorHandle ? `@${l.creatorHandle}` : l.source}</div>
                {l.error && <div className="break-all font-mono text-[11px] text-bad">{l.error}</div>}
              </div>,
              <Status key="s" s={l.status} />,
              ago(l.createdAt),
            ],
          }))}
        />
      </Panel>
    </div>
  );
}
