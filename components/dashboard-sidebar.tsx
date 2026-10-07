"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Plus,
  Settings,
  Instagram,
  Feather,
  Clapperboard,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", icon: Home, label: "Dashboard", exact: true },
  { href: "/dashboard/new", icon: Plus, label: "New Project", exact: false },
  { href: "/dashboard/instagram", icon: Instagram, label: "Instagram Posts", exact: false },
  { href: "/dashboard/library", icon: Clapperboard, label: "Library", exact: false },
  { href: "/dashboard/ideas", icon: Lightbulb, label: "Idea Bank", exact: false },
  { href: "/dashboard/style", icon: Feather, label: "Style Bank", exact: false },
];

const STORAGE_KEY = "vidoscript_sidebar_collapsed";

export function DashboardSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      className={cn(
        "border-r border-neutral-800 flex flex-col bg-black flex-shrink-0 transition-[width] duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo + toggle */}
      <div className={cn("flex items-center h-14 flex-shrink-0", collapsed ? "justify-center px-0" : "justify-between px-5")}>
        {!collapsed && (
          <Link href="/" className="text-lg font-semibold tracking-tight text-white truncate">
            VidoScript
          </Link>
        )}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="text-neutral-500 hover:text-white transition p-1.5 rounded-md hover:bg-neutral-800"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className={cn("flex-1 space-y-1 mt-4", collapsed ? "px-2" : "px-3")}>
        {NAV.map(({ href, icon: Icon, label, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center rounded-md text-base font-medium transition",
                collapsed ? "justify-center h-10" : "gap-2.5 px-3 py-2",
                active
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-white hover:bg-neutral-800"
              )}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-neutral-800 py-3 space-y-1", collapsed ? "px-2" : "px-3")}>
        <Link
          href="/dashboard/settings"
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "flex items-center rounded-md text-base font-medium text-neutral-500 hover:text-white hover:bg-neutral-800 transition",
            collapsed ? "justify-center h-10" : "gap-2.5 px-3 py-2"
          )}
        >
          <Settings size={18} className="flex-shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
        <div className={cn("flex items-center py-2", collapsed ? "justify-center" : "gap-2.5 px-3")}>
          <UserButton appearance={{ elements: { avatarBox: "w-7 h-7" } }} />
          {!collapsed && <span className="text-sm text-neutral-500">Account</span>}
        </div>
      </div>
    </aside>
  );
}
