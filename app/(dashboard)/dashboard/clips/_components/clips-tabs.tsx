"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { Compass, Film } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

// Clips area tabs: your own videos | Discover (the clip scout).
export function ClipsTabs() {
  const pathname = usePathname();
  const discover = pathname.startsWith("/dashboard/clips/discover");
  const found = useQuery(api.scout.list, { minScore: 60 });
  const fresh = (found ?? []).filter((v) => v.status === "new" && Date.now() - v.firstSeenAt < 86_400_000).length;
  const tab = (active: boolean) =>
    cn(
      "-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-1 text-sm transition",
      active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
    );
  return (
    <nav aria-label="Clips sections" className="flex gap-5 border-b border-line">
      <Link href="/dashboard/clips" className={tab(!discover)} aria-current={!discover ? "page" : undefined}>
        <Film size={15} /> My videos
      </Link>
      <Link href="/dashboard/clips/discover" className={tab(discover)} aria-current={discover ? "page" : undefined}>
        <Compass size={15} /> Discover
        {fresh > 0 && (
          <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent" title="New picks scoring 60+ in the last 24 hours">
            {fresh}
          </span>
        )}
      </Link>
    </nav>
  );
}
