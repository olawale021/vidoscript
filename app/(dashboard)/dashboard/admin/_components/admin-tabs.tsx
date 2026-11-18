"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { Dot } from "./bits";

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
    <nav aria-label="Admin sections" className="flex gap-4 overflow-x-auto border-b border-line sm:gap-[22px]">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-[7px] whitespace-nowrap border-b-2 pb-[11px] pt-2.5 text-sm transition",
              active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
            )}
          >
            {t.label}
            {t.label === "Errors" && errors24h ? (
              <span className="rounded-full bg-bad/18 px-1.5 text-[11px] font-bold text-bad tabular">{errors24h}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

// Render worker heartbeat status for the page header.
export function HealthPill() {
  const { isAuthenticated } = useConvexAuth();
  const latest = useQuery(api.system.latest, isAuthenticated ? {} : "skip");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  if (latest === undefined) return null;

  const age = latest ? Math.max(0, Math.round((now - latest.createdAt) / 1000)) : null;
  const tone = age === null || age > 300 ? "bad" : age > 90 ? "warn" : "ok";
  const ageText = age === null ? "" : age < 120 ? `${age}s` : age < 7200 ? `${Math.round(age / 60)}m` : `${Math.round(age / 3600)}h`;
  const state = !latest
    ? "No heartbeat yet"
    : tone === "ok"
      ? `Render worker ${latest.workerBusy ? "rendering" : "idle"}`
      : "Render worker not responding";

  return (
    <span className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-line-strong bg-surface px-3 py-[7px] text-[13px] text-muted">
      <Dot tone={tone} />
      <span className="truncate">
        {state}
        {latest && (
          <>
            {" "}· heartbeat <span className="font-mono">{ageText}</span> ago
          </>
        )}
      </span>
    </span>
  );
}
