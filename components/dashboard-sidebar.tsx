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
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Scissors,
  X,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", icon: Home, label: "Dashboard", exact: true },
  { href: "/dashboard/new", icon: Plus, label: "New Project", exact: false },
  { href: "/dashboard/clips", icon: Scissors, label: "Clips", exact: false },
  { href: "/dashboard/instagram", icon: Instagram, label: "Instagram Posts", exact: false },
  { href: "/dashboard/library", icon: Clapperboard, label: "Library", exact: false },
  { href: "/dashboard/ideas", icon: Lightbulb, label: "Idea Bank", exact: false },
  { href: "/dashboard/style", icon: Feather, label: "Style Bank", exact: false },
];

const STORAGE_KEY = "vidoscript_sidebar_collapsed";

function useNav() {
  const pathname = usePathname();
  const admin = useQuery(api.admin.amIAdmin);
  const nav = admin ? [...NAV, { href: "/dashboard/admin", icon: Shield, label: "Admin", exact: false }] : NAV;
  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return { nav, isActive, pathname };
}

function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { nav, isActive } = useNav();
  return (
    <nav className={cn("flex-1 space-y-1 mt-4 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
      {nav.map(({ href, icon: Icon, label, exact }) => {
        const active = isActive(href, exact);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center rounded-md text-base font-medium transition",
              collapsed ? "justify-center h-10" : "gap-2.5 px-3 py-2.5 md:py-2",
              active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white hover:bg-neutral-800"
            )}
          >
            <Icon size={18} className="flex-shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function NavFooter({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <div className={cn("border-t border-neutral-800 py-3 space-y-1", collapsed ? "px-2" : "px-3")}>
      <Link
        href="/dashboard/settings"
        onClick={onNavigate}
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
  );
}

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
        "hidden md:flex border-r border-neutral-800 flex-col bg-black flex-shrink-0 transition-[width] duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
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
      <NavLinks collapsed={collapsed} />
      <NavFooter collapsed={collapsed} />
    </aside>
  );
}

// Phones: top bar with a slide-in menu.
export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const { nav, isActive, pathname } = useNav();
  const current = nav.find((n) => isActive(n.href, n.exact))?.label ?? "VidoScript";

  // Close the menu on navigation and lock page scroll while it's open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header
        className="md:hidden flex items-center justify-between gap-2 border-b border-neutral-800 bg-black px-3 flex-shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)", minHeight: "calc(3.25rem + env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="p-2 -ml-1 rounded-md text-neutral-300 hover:text-white hover:bg-neutral-800"
        >
          <Menu size={22} />
        </button>
        <span className="text-base font-semibold text-white truncate">{current}</span>
        <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside
            className="relative w-72 max-w-[85vw] h-full bg-black border-r border-neutral-800 flex flex-col"
            style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between h-14 px-5 flex-shrink-0">
              <Link href="/" className="text-lg font-semibold tracking-tight text-white">
                VidoScript
              </Link>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800"
              >
                <X size={20} />
              </button>
            </div>
            <NavLinks collapsed={false} onNavigate={() => setOpen(false)} />
            <NavFooter collapsed={false} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
