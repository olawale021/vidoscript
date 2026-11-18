"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Loader2, Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Panel, StatRow } from "@/components/ui/kit";
import { Pill, Share, Table, Who, ago, usd } from "../_components/bits";
import { useUserProfiles } from "../_components/use-user-profiles";

type Filter = "all" | "active" | "failed";
const WEEK = 7 * 86400_000;

export default function AdminUsersPage() {
  const users = useQuery(api.admin.users);
  const profiles = useUserProfiles(users?.map((u) => u.userId) ?? []);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  if (users === undefined) return <Loader2 className="animate-spin text-faint" />;

  const active7 = users.filter((u) => Date.now() - u.lastActive < WEEK).length;
  const projects = users.reduce((s, u) => s + u.projects, 0);
  const spend = users.reduce((s, u) => s + u.aiCostUsd, 0);
  const maxSpend = Math.max(0, ...users.map((u) => u.aiCostUsd));
  const per = (n: number) => (users.length ? n / users.length : 0);

  const needle = q.trim().toLowerCase();
  const shown = users.filter((u) => {
    const p = profiles[u.userId];
    if (needle && !`${p?.name ?? ""} ${p?.email ?? ""} ${u.userId}`.toLowerCase().includes(needle)) return false;
    if (filter === "active") return Date.now() - u.lastActive < WEEK;
    if (filter === "failed") return u.failedRenders > 0;
    return true;
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <StatRow
        className="lg:grid-cols-4"
        items={[
          { k: "Users with activity", v: users.length.toLocaleString() },
          {
            k: "Active last 7 days",
            v: active7.toLocaleString(),
            d: users.length ? `${Math.round((active7 / users.length) * 100)}% of users` : undefined,
          },
          { k: "Projects", v: projects.toLocaleString(), d: `${per(projects).toFixed(1)} per user`, flat: true },
          { k: "AI spend · all time", v: usd(spend), d: `${usd(per(spend))} per user`, flat: true },
        ]}
      />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <label className="flex h-8 min-w-0 max-w-[280px] flex-1 basis-48 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 text-faint">
            <Search size={14} className="flex-shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search users"
              className="w-full min-w-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Pill pressed={filter === "all"} onClick={() => setFilter("all")}>All</Pill>
            <Pill pressed={filter === "active"} onClick={() => setFilter("active")}>Active 7d</Pill>
            <Pill pressed={filter === "failed"} onClick={() => setFilter("failed")}>Has failures</Pill>
          </div>
        </div>
        <Table
          cols={[
            { label: "User" },
            { label: "Projects", num: true },
            { label: "Renders", num: true },
            { label: "Failed", num: true },
            { label: "Library", num: true },
            { label: "AI cost", num: true },
            { label: "Last active", num: true },
          ]}
          empty={users.length === 0 ? "No users yet." : needle ? `No users match “${q.trim()}”.` : "No users match this filter."}
          rows={shown.map((u) => {
            const p = profiles[u.userId];
            const href = `/dashboard/admin/users/${u.userId}`;
            return {
              key: u.userId,
              href,
              cells: [
                <Link key="u" href={href} className="block">
                  <Who id={u.userId} name={p?.name ?? p?.email ?? null} email={p?.name ? p.email : null} />
                </Link>,
                u.projects,
                u.renders,
                <span key="f" className={u.failedRenders ? "text-bad" : undefined}>{u.failedRenders}</span>,
                u.libraryItems,
                <Share key="c" value={u.aiCostUsd} max={maxSpend} />,
                u.lastActive ? ago(u.lastActive) : "—",
              ],
            };
          })}
        />
      </Panel>
    </div>
  );
}
