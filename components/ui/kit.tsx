"use client";

// Small building blocks from the VidoScript redesign prototype. Colours come
// from the tokens in app/globals.css (bg-surface, border-line, text-faint…).

import type React from "react";
import { cn } from "@/lib/utils";

export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("text-[11px] font-semibold uppercase tracking-[0.12em] text-faint", className)}>{children}</span>;
}

export function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-[12px] border border-line bg-surface min-w-0", className)}>{children}</section>;
}

export function PanelHeader({ title, children, className }: { title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

// Single-choice segmented control ("segbig" in the prototype).
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
  label,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-0.5 rounded-[9px] border border-line bg-bg p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-[7px] transition disabled:cursor-not-allowed disabled:opacity-35",
            size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-[13px]",
            o.value === value ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tone({ tone, children, className }: { tone: "ok" | "warn" | "bad" | "muted"; children: React.ReactNode; className?: string }) {
  const cls = {
    ok: "text-ok bg-ok/12",
    warn: "text-accent bg-accent-soft",
    bad: "text-bad bg-bad/14",
    muted: "text-muted bg-surface-3",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-semibold", cls, className)}>{children}</span>;
}

// Circular score (0–100) like the prototype's clip score ring.
export function Ring({ value, size = 40, className, title }: { value: number; size?: number; className?: string; title?: string }) {
  const color = value >= 80 ? "var(--color-ok)" : value >= 65 ? "var(--color-accent)" : "var(--color-faint)";
  return (
    <span
      title={title}
      className={cn("relative grid flex-shrink-0 place-items-center rounded-full", className)}
      style={{ width: size, height: size, background: `conic-gradient(${color} ${value}%, var(--color-surface-3) 0)` }}
    >
      <span className="absolute inset-[3px] rounded-full bg-surface" />
      <b className="relative text-xs tabular">{value}</b>
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-[34px] flex-shrink-0 rounded-full border transition disabled:opacity-40 before:absolute before:-inset-2 before:content-['']",
        checked ? "border-fg bg-fg" : "border-line-strong bg-surface-3"
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform",
          checked ? "translate-x-3.5 bg-bg" : "bg-faint"
        )}
      />
    </button>
  );
}

export function StatRow({ items, className }: { items: { k: string; v: React.ReactNode; d?: React.ReactNode; flat?: boolean }[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-surface sm:grid-cols-3 lg:grid-cols-5", className)}>
      {items.map((s, i) => (
        <div key={i} className="grid min-w-0 gap-1 border-line px-4 py-3.5 [&:not(:first-child)]:border-l max-sm:[&:nth-child(odd)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
          <span className="text-xs text-faint">{s.k}</span>
          <span className="text-[22px] font-semibold tracking-tight tabular">{s.v}</span>
          {s.d !== undefined && <span className={cn("text-xs", s.flat ? "text-faint" : "text-ok")}>{s.d}</span>}
        </div>
      ))}
    </div>
  );
}

export function Chip({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition",
        pressed ? "border-fg bg-surface-3 text-fg" : "border-line-strong text-muted hover:text-fg",
        className
      )}
    >
      {children}
    </button>
  );
}

// Thin progress bar (amber by default, like the prototype).
export function Bar({ value, className, tone = "accent" }: { value: number; className?: string; tone?: "accent" | "fg" | "bad" }) {
  const fill = { accent: "bg-accent", fg: "bg-fg", bad: "bg-bad" }[tone];
  return (
    <div className={cn("h-[5px] overflow-hidden rounded-full bg-surface-3", className)}>
      <span className={cn("block h-full rounded-full transition-[width]", fill)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
