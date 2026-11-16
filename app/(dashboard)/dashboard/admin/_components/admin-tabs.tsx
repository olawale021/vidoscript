"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/admin", label: "System", exact: true },
  { href: "/dashboard/admin/costs", label: "AI costs", exact: false },
  { href: "/dashboard/admin/users", label: "Users", exact: false },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 rounded-lg border border-neutral-800 p-1 bg-neutral-950">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition",
              active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
