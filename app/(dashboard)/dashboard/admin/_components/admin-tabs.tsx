"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/admin", label: "System", exact: true },
  { href: "/dashboard/admin/costs", label: "AI costs", exact: false },
  { href: "/dashboard/admin/users", label: "Users", exact: false },
  { href: "/dashboard/admin/errors", label: "Errors", exact: false },
];

export function AdminTabs() {
  const pathname = usePathname();
  // Wait for the Convex session (admin queries throw while signed out).
  const { isAuthenticated } = useConvexAuth();
  const errors24h = useQuery(api.errors.recentCount, isAuthenticated ? {} : "skip");
  return (
    <nav className="flex gap-1 rounded-lg border border-neutral-800 p-1 bg-neutral-950 max-w-full overflow-x-auto">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap",
              active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white"
            )}
          >
            {t.label}
            {t.label === "Errors" && errors24h ? (
              <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">{errors24h}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
