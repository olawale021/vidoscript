"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Panel, Stat, Table, ago, duration, usd } from "../../_components/bits";
import { useUserProfiles } from "../../_components/use-user-profiles";

const statusColor = (s: string) =>
  s === "failed" ? "text-red-300" : s === "done" || s === "ready" ? "text-emerald-300" : "text-amber-200";

export default function AdminUserDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const data = useQuery(api.admin.userDetail, { userId });
  const profile = useUserProfiles([userId])[userId];

  if (data === undefined) return <Loader2 className="animate-spin text-neutral-500" />;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/admin/users" className="text-sm text-neutral-500 hover:text-white inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Users
        </Link>
        <h2 className="text-xl font-semibold text-white mt-2">{profile?.name ?? profile?.email ?? userId}</h2>
        <div className="text-sm text-neutral-500">
          {profile?.email && <span>{profile.email} · </span>}
          <span className="font-mono text-xs">{userId}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Projects" value={data.projects.length} />
        <Stat label="Renders" value={data.renders.length} />
        <Stat label="Library items" value={data.library.length} />
        <Stat label="AI cost" value={usd(data.ai.costUsd)} sub={`${data.ai.calls} calls`} />
      </div>

      <Panel title="Projects (latest 50)">
        <Table
          head={["Title", "Status", "Updated"]}
          empty="No projects."
          rows={data.projects.map((p) => [
            <div key="t">
              <div className="text-neutral-200">{p.title}</div>
              {p.error && <div className="text-xs text-red-300 break-all">{p.error}</div>}
            </div>,
            <span key="s" className={statusColor(p.status)}>{p.status}</span>,
            ago(p.updatedAt),
          ])}
        />
      </Panel>

      <Panel title="Renders (latest 50)">
        <Table
          head={["Render", "Status", "Duration", "Updated"]}
          empty="No renders."
          rows={data.renders.map((r) => [
            <div key="r">
              <div className="font-mono text-xs text-neutral-400">{r.id}</div>
              {r.error && <div className="text-xs text-red-300 break-all">{r.error}</div>}
            </div>,
            <span key="s" className={statusColor(r.status)}>{r.status}</span>,
            r.startedAt && r.finishedAt ? duration((r.finishedAt - r.startedAt) / 1000) : "—",
            ago(r.updatedAt),
          ])}
        />
      </Panel>

      <div className="grid lg:grid-cols-2 gap-5">
        <Panel title="Library (latest 50)">
          <Table
            head={["Item", "Status", "Added"]}
            empty="No library items."
            rows={data.library.map((l) => [
              <div key="l">
                <div className="text-neutral-200">{l.creatorHandle ? `@${l.creatorHandle}` : l.source}</div>
                {l.error && <div className="text-xs text-red-300 break-all">{l.error}</div>}
              </div>,
              <span key="s" className={statusColor(l.status)}>{l.status}</span>,
              ago(l.createdAt),
            ])}
          />
        </Panel>
        <Panel title="Recent AI calls">
          <Table
            head={["Feature", "Model", "Cost", "When"]}
            empty="No AI calls."
            rows={data.ai.recent.map((u) => [u.feature, u.model, usd(u.costUsd), ago(u.createdAt)])}
          />
        </Panel>
      </div>
    </div>
  );
}
