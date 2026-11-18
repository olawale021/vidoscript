// Visual stand-ins for video frames (from the redesign prototype). Plain
// gradients + a silhouette, so the homepage has no image downloads.

import type React from "react";
import { cn } from "@/lib/utils";

export const TONES = {
  t1: "radial-gradient(120% 80% at 70% 20%, #f7a35c 0%, #b14a3a 35%, #2a1418 75%)",
  t2: "radial-gradient(90% 70% at 30% 70%, #3fa3a8 0%, #1a4d63 45%, #0b1622 85%)",
  t3: "linear-gradient(160deg, #2b2b31 0%, #57534e 45%, #c8b9a0 100%)",
  t4: "radial-gradient(80% 60% at 50% 40%, #e85d9c 0%, #6b2a7a 45%, #160b1f 85%)",
  t5: "linear-gradient(200deg, #9ec27a 0%, #3f6b3b 45%, #12200f 100%)",
  t6: "radial-gradient(100% 70% at 20% 30%, #ffd88a 0%, #c9853a 40%, #3a2312 85%)",
  t7: "linear-gradient(140deg, #6f8ee8 0%, #2c3c86 50%, #0d1230 100%)",
  t8: "radial-gradient(90% 80% at 60% 60%, #d0d0d0 0%, #6a6a70 45%, #18181b 90%)",
} as const;
export type Tone = keyof typeof TONES;

export function Thumb({
  tone,
  figure,
  className,
  children,
}: {
  tone: Tone;
  figure?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)} style={{ background: TONES[tone] }}>
      {figure && (
        <div
          className="absolute bottom-0 left-1/2 w-[46%] -translate-x-1/2 bg-black/30"
          style={{ aspectRatio: "1 / 1.25", borderRadius: "50% 50% 18% 18% / 40% 40% 12% 12%" }}
        >
          <div className="absolute left-1/2 top-[-34%] aspect-square w-[48%] -translate-x-1/2 rounded-full bg-black/30" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent from-55% to-black/55" />
      {children}
    </div>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-fg text-bg", className)}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
        <path d="M5 4h4l3 9 3-9h4l-5.2 14a2 2 0 0 1-3.6 0z" />
      </svg>
    </span>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  yt: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="4" />
      <path d="m10 9.5 4.5 2.5-4.5 2.5z" />
    </>
  ),
  ig: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r=".6" />
    </>
  ),
};

export function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("h-4 w-4 flex-shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}
