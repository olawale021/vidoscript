"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Thumb } from "./art";

// Hero demo: a 38-second source playing (waveform + timecode) while the
// script's beats reveal at their timestamps. Static when motion is reduced.

const BEATS = [
  { at: 0, tc: "0:00", tag: "Hook", text: "Your morning routine is costing you two hours a week. Here's where they go." },
  { at: 6, tc: "0:06", tag: "Setup", text: "I timed every step for seven days. Coffee wasn't the problem." },
  { at: 19, tc: "0:19", tag: "Payoff", text: "It was the eleven minutes I spent deciding what to do first." },
  { at: 31, tc: "0:31", tag: "Call to action", text: "Write tomorrow's first task tonight. Then tell me how long you saved." },
];

// Deterministic "random" bar heights/delays so server and client render match.
const BARS = Array.from({ length: 28 }, (_, n) => {
  const r1 = (Math.sin(n * 12.9898) * 43758.5453) % 1;
  const r2 = (Math.sin(n * 78.233) * 12345.6789) % 1;
  return { h: Math.round(30 + Math.abs(r1) * 70), d: -Math.round(Math.abs(r2) * 10) / 10 };
});

export function HeroDemo() {
  const [sec, setSec] = useState(4);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    if (mq.matches) return;
    const id = window.setInterval(() => setSec((s) => (s + 1) % 39), 260);
    return () => window.clearInterval(id);
  }, []);

  const shown = reduce ? 38 : sec;

  return (
    <div
      aria-label="Example: a 38-second video turned into a script"
      role="figure"
      className="relative grid min-w-0 grid-cols-[120px_1fr] gap-2.5 rounded-[18px] border border-line-strong bg-surface p-2.5 shadow-[0_40px_80px_-30px_rgba(0,0,0,.8)] sm:grid-cols-[170px_1fr] sm:gap-3.5 sm:p-3.5"
    >
      <style>{`
        @keyframes vs-blink { 50% { opacity: .2; } }
        @keyframes vs-wave { from { transform: scaleY(.35); } to { transform: scaleY(1); } }
        .vs-rec { animation: vs-blink 1.2s steps(2) infinite; }
        .vs-bar { transform-origin: bottom; animation: vs-wave 1s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .vs-rec, .vs-bar { animation: none; } }
      `}</style>
      <Thumb tone="t1" figure className="aspect-[9/16] min-w-0 self-start rounded-[10px]">
        <span className="absolute left-2.5 top-2.5 z-[2] flex items-center gap-1.5 font-mono text-[11px] text-white">
          <i className="vs-rec h-[7px] w-[7px] rounded-full bg-bad" />
          SOURCE
        </span>
        <div className="absolute bottom-[30px] left-2.5 right-2.5 z-[2] flex h-[22px] items-end gap-0.5" aria-hidden="true">
          {BARS.map((b, i) => (
            <span
              key={i}
              className="vs-bar flex-1 rounded-[1px] bg-white/75"
              style={{ height: `${b.h}%`, animationDelay: `${b.d}s` }}
            />
          ))}
        </div>
        <div className="absolute bottom-2.5 left-2.5 right-2.5 z-[2] flex justify-between font-mono text-[11px] tabular text-white">
          <span>00:00:{String(shown).padStart(2, "0")}</span>
          <span className="max-sm:hidden">00:00:38</span>
        </div>
      </Thumb>

      <div className="flex min-w-0 flex-col gap-2.5 px-1 py-1.5">
        <div className="flex items-center justify-between border-b border-line pb-2 text-xs text-faint">
          <span>Your script · 112 words</span>
          <span className="font-mono">v1</span>
        </div>
        {BEATS.map((b, i) => (
          <div
            key={b.tag}
            className={cn(
              "grid grid-cols-1 gap-0 transition-[opacity,transform] duration-400 sm:grid-cols-[52px_1fr] sm:gap-2.5",
              shown < b.at ? "opacity-25" : "opacity-100"
            )}
          >
            <span className="pt-0.5 font-mono text-[11px] tabular text-faint max-sm:hidden">{b.tc}</span>
            <div className="min-w-0">
              <span
                className={cn(
                  "mb-0.5 inline-block text-[10px] font-bold uppercase tracking-[0.08em]",
                  i === 0 ? "text-accent" : "text-faint"
                )}
              >
                {b.tag}
              </span>
              <p className="text-[13px] leading-[1.45] sm:text-sm">{b.text}</p>
            </div>
          </div>
        ))}
        <div className="mt-auto hidden flex-wrap gap-1.5 border-t border-line pt-2.5 sm:flex">
          {["Tone: candid", "Pace: 2.9 words/sec", "Open loop at 0:06"].map((c) => (
            <span key={c} className="whitespace-nowrap rounded-full border border-line bg-surface-2 px-2 py-[3px] text-[11px] text-muted">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
