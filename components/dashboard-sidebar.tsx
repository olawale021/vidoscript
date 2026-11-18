"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Clapperboard,
  Feather,
  FileText,
  Home,
  Instagram,
  Lightbulb,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Scissors,
  Search,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { openCommandPalette } from "@/components/command-palette";

type NavItem = { href: string; icon: typeof Home; label: string; exact?: boolean; live?: boolean };

// Grouped navigation (redesign): Home · Create · Library · Workspace.
function useNav() {
  const pathname = usePathname();
  const admin = useQuery(api.admin.amIAdmin);
  const busy = useQuery(api.clips.busyCount) ?? 0;
  const groups: { label: string | null; items: NavItem[] }[] = [
    { label: null, items: [{ href: "/dashboard", icon: Home, label: "Home", exact: true }] },
    {
      label: "Create",
      items: [
        { href: "/dashboard/new", icon: FileText, label: "Scripts" },
        { href: "/dashboard/clips", icon: Scissors, label: "Clips", live: busy > 0 },
        { href: "/dashboard/stories", icon: BookOpen, label: "Stories" },
        { href: "/dashboard/instagram", icon: Instagram, label: "Instagram posts" },
      ],
    },
    {
      label: "Library",
      items: [
        { href: "/dashboard/library", icon: Clapperboard, label: "Saved videos" },
        { href: "/dashboard/ideas", icon: Lightbulb, label: "Idea bank" },
        { href: "/dashboard/style", icon: Feather, label: "Style bank" },
      ],
    },
    {
      label: "Workspace",
      items: [
        ...(admin ? [{ href: "/dashboard/admin", icon: Shield, label: "Admin" }] : []),
        { href: "/dashboard/settings", icon: Settings, label: "Settings" },
      ],
    },
  ];
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return { groups, isActive, pathname, admin: !!admin, busy };
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight text-fg">
      <span className="grid h-[26px] w-[26px] flex-shrink-0 place-items-center rounded-[7px] bg-fg text-bg">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
          <path d="M5 4h4l3 9 3-9h4l-5.2 14a2 2 0 0 1-3.6 0z" />
        </svg>
      </span>
      {!compact && "VidoScript"}
    </Link>
  );
}

function NavGroups({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { groups, isActive } = useNav();
  return (
    <nav className={cn("flex-1 overflow-y-auto pb-3 pt-1.5", collapsed ? "px-2" : "px-2.5")}>
      <div className="grid gap-3.5">
        {groups.map((g, gi) =>
          g.items.length === 0 ? null : (
            <div key={gi} className="grid gap-0.5">
              {g.label && !collapsed && (
                <span className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{g.label}</span>
              )}
              {g.items.map(({ href, icon: Icon, label, exact, live }) => {
                const active = isActive(href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    title={collapsed ? label : undefined}
                    className={cn(
                      "relative flex items-center rounded-lg text-[14px] transition",
                      collapsed ? "h-10 justify-center" : "gap-2.5 px-2.5 py-[7px]",
                      active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface hover:text-fg"
                    )}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {live && (
                      <span
                        title="A video is being processed"
                        className={cn(
                          "h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_var(--color-accent-soft)]",
                          collapsed ? "absolute right-2 top-2" : "ml-auto"
                        )}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          )
        )}
      </div>
    </nav>
  );
}

function UsageCard() {
  const usage = useQuery(api.usage.myMonth);
  if (!usage) return null;
  return (
    <div className="grid gap-1.5 rounded-[10px] border border-line bg-surface p-3">
      <div className="flex justify-between text-xs text-muted">
        <span>Minutes this month</span>
        <span className="font-mono tabular">{usage.minutes}</span>
      </div>
      <div className="flex justify-between text-xs text-faint">
        <span>AI spend</span>
        <span className="font-mono tabular">${usage.costUsd.toFixed(2)}</span>
      </div>
    </div>
  );
}

function SidebarBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <>
      <div className={cn("grid gap-2.5 pb-2", collapsed ? "px-2" : "px-3.5")}>
        <button
          onClick={() => {
            onNavigate?.();
            openCommandPalette();
          }}
          title="Search (⌘K)"
          className={cn(
            "flex h-[34px] items-center gap-2 rounded-[9px] border border-line bg-surface text-[13px] text-faint transition hover:text-muted",
            collapsed ? "justify-center" : "px-2.5"
          )}
        >
          <Search size={15} />
          {!collapsed && (
            <>
              Search projects
              <kbd className="ml-auto rounded-[5px] border border-line-strong px-1.5 font-mono text-[11px]">⌘K</kbd>
            </>
          )}
        </button>
        <Link
          href="/dashboard/new"
          onClick={onNavigate}
          title="New project"
          className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-fg text-[13px] font-semibold text-bg transition hover:bg-neutral-200"
        >
          <Plus size={15} />
          {!collapsed && "New project"}
        </Link>
      </div>
      <NavGroups collapsed={collapsed} onNavigate={onNavigate} />
      <div className={cn("grid gap-3 border-t border-line py-3.5", collapsed ? "px-2" : "px-3.5")}>
        {!collapsed && <UsageCard />}
        <div className={cn("flex items-center gap-2.5 text-[13px] text-muted", collapsed && "justify-center")}>
          <UserButton appearance={{ elements: { avatarBox: "w-7 h-7" } }} />
          {!collapsed && "Account"}
        </div>
      </div>
    </>
  );
}

const STORAGE_KEY = "vidoscript_sidebar_collapsed";

// Desktop / tablet: collapsible sidebar (hidden on phones).
export function DashboardSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // storage unavailable
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "hidden flex-shrink-0 flex-col border-r border-line bg-bg transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-[248px]"
      )}
    >
      <div className={cn("flex h-14 flex-shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-4")}>
        {!collapsed && <Logo />}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-1.5 text-faint transition hover:bg-surface-2 hover:text-fg"
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <SidebarBody collapsed={collapsed} />
    </aside>
  );
}

// The full menu as a slide-in drawer (phones: opened from the tab bar's "More").
function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <aside
        className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-bg"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-14 flex-shrink-0 items-center justify-between px-4">
          <Logo />
          <button onClick={onClose} aria-label="Close menu" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <X size={20} />
          </button>
        </div>
        <SidebarBody collapsed={false} onNavigate={onClose} />
      </aside>
    </div>
  );
}

// Phones: slim top bar (logo, search, account) …
export function MobileTopBar() {
  return (
    <header
      className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-line bg-bg px-4 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)", minHeight: "calc(3.25rem + env(safe-area-inset-top))" }}
    >
      <Logo />
      <div className="flex items-center gap-1">
        <button onClick={openCommandPalette} aria-label="Search" className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-fg">
          <Search size={20} />
        </button>
        <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
      </div>
    </header>
  );
}

// … and a bottom tab bar, with "More" opening the full menu.
export function MobileTabBar() {
  const { isActive, pathname, busy } = useNav();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const tabs: NavItem[] = [
    { href: "/dashboard", icon: Home, label: "Home", exact: true },
    { href: "/dashboard/new", icon: FileText, label: "Scripts" },
    { href: "/dashboard/clips", icon: Scissors, label: "Clips", live: busy > 0 },
    { href: "/dashboard/stories", icon: BookOpen, label: "Stories" },
  ];
  return (
    <>
      <nav
        aria-label="App navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-bg/95 backdrop-blur-md md:hidden"
        style={{
          paddingBottom: "calc(6px + env(safe-area-inset-bottom))",
          paddingLeft: "max(8px, env(safe-area-inset-left))",
          paddingRight: "max(8px, env(safe-area-inset-right))",
          paddingTop: 6,
        }}
      >
        {tabs.map(({ href, icon: Icon, label, exact, live }) => (
          <Link
            key={href}
            href={href}
            className={cn("relative grid justify-items-center gap-[3px] py-1.5 text-[11px]", isActive(href, exact) ? "text-fg" : "text-faint")}
          >
            <Icon size={20} />
            {label}
            {live && <span className="absolute left-[calc(50%+6px)] top-1 h-[7px] w-[7px] rounded-full bg-accent" />}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="grid justify-items-center gap-[3px] py-1.5 text-[11px] text-faint">
          <Menu size={20} />
          More
        </button>
      </nav>
      <Drawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
