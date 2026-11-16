"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Panel, Stat, Table, ago, usd } from "../_components/bits";
import { useUserProfiles } from "../_components/use-user-profiles";

export default function AdminUsersPage() {
  const users = useQuery(api.admin.users);
  const profiles = useUserProfiles(users?.map((u) => u.userId) ?? []);

  if (users === undefined) return <Loader2 className="animate-spin text-neutral-500" />;

  const active7 = users.filter((u) => Date.now() - u.lastActive < 7 * 86400_000).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Users with activity" value={users.length} />
        <Stat label="Active last 7 days" value={active7} />
        <Stat label="Projects" value={users.reduce((s, u) => s + u.projects, 0)} />
        <Stat label="AI spend (all time)" value={usd(users.reduce((s, u) => s + u.aiCostUsd, 0))} />
      </div>

      <Panel title="Users">
        <Table
          head={["User", "Projects", "Renders", "Failed", "Library", "AI cost", "Last active"]}
          empty="No users yet."
          rows={users.map((u) => {
            const p = profiles[u.userId];
            return [
              <Link key="u" href={`/dashboard/admin/users/${u.userId}`} className="hover:text-white hover:underline underline-offset-2">
                <div className="text-neutral-200">{p?.name ?? p?.email ?? u.userId}</div>
                {p?.name && p.email && <div className="text-xs text-neutral-500">{p.email}</div>}
              </Link>,
              u.projects,
              u.renders,
              <span key="f" className={u.failedRenders ? "text-red-300" : undefined}>{u.failedRenders}</span>,
              u.libraryItems,
              usd(u.aiCostUsd),
              u.lastActive ? ago(u.lastActive) : "—",
            ];
          })}
        />
      </Panel>
    </div>
  );
}
