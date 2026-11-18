import { Show } from "@clerk/nextjs";
import Link from "next/link";
import type React from "react";
import { HeroDemo } from "./_landing/demo";
import { PasteBox } from "./_landing/paste-box";
import { Icon, LogoMark, Thumb, TONES, type Tone } from "./_landing/art";

const wrap = "mx-auto w-full max-w-[1160px] pl-[max(20px,env(safe-area-inset-left,0px))] pr-[max(20px,env(safe-area-inset-right,0px))]";
const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition";
const btnPrimary = `${btn} bg-fg text-bg hover:bg-[#dcdcd8]`;
const btnGhost = `${btn} border border-line-strong text-muted hover:border-[#4a4a52] hover:text-fg`;
const btnSm = "h-8 rounded-lg px-3 text-[13px]";
const btnMd = "h-[38px] rounded-[10px] px-4 text-sm";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">{children}</span>;
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-2.5 max-w-[18em] text-balance text-[clamp(28px,3.4vw,40px)] font-semibold leading-[1.15] tracking-[-0.02em]">
          {title}
        </h2>
      </div>
      {children && <p className="max-w-[26em] text-muted">{children}</p>}
    </div>
  );
}

function Cell({ className, title, children, art }: { className?: string; title: string; children: React.ReactNode; art: React.ReactNode }) {
  return (
    <article
      className={`relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-[18px] border border-line bg-surface p-[22px] ${className ?? ""}`}
    >
      <h3 className="text-lg font-semibold tracking-[-0.02em]">{title}</h3>
      <p className="max-w-[34em] text-sm text-muted">{children}</p>
      <div className="mt-[18px]" aria-hidden="true">
        {art}
      </div>
    </article>
  );
}

const STEPS = [
  {
    n: "STEP 1",
    title: "Paste or upload",
    text: "A YouTube or Instagram link up to 3 hours long, or an MP4 or MOV upload up to 5 GB.",
  },
  { n: "STEP 2", title: "We break it down", text: "Transcript, hook, beats, pacing in words per second, and tone." },
  {
    n: "STEP 3",
    title: "Get your script",
    text: "An original script with the same shape, written in the style you've trained.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-clip bg-bg text-[15px] leading-normal text-fg">
      {/* Nav */}
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b border-line bg-bg/80 backdrop-blur-md">
        <div className={`${wrap} flex h-16 items-center justify-between gap-4`}>
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.02em]">
            <LogoMark />
            VidoScript
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="#product" className="hover:text-fg">
              Product
            </a>
            <a href="#how" className="hover:text-fg">
              How it works
            </a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Show when="signed-out">
              <Link href="/sign-in" className={`${btnGhost} ${btnSm} max-sm:hidden`}>
                Sign in
              </Link>
              <Link href="/sign-up" className={`${btnPrimary} ${btnSm}`}>
                Get started
              </Link>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className={`${btnPrimary} ${btnSm}`}>
                Open app
                <Icon name="arrow" className="h-3.5 w-3.5" />
              </Link>
            </Show>
          </div>
        </div>
      </header>

      <main className={wrap}>
        {/* Hero */}
        <section className="grid items-center gap-10 pb-12 pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-[72px] lg:pt-[88px]">
          <div className="min-w-0">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-line-strong py-[5px] pl-1.5 pr-3 text-[13px] text-muted">
              <b className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">New</b>
              <span className="truncate">Story Studio: idea to finished video</span>
            </span>
            <h1 className="mb-[18px] mt-[22px] text-balance text-[clamp(40px,5.6vw,68px)] font-semibold leading-[1.02] tracking-[-0.035em]">
              Any video in.
              <br />A script in <em className="not-italic text-faint">your voice</em> out.
            </h1>
            <p className="max-w-[30em] text-lg text-muted">
              Paste a link to a video that works. VidoScript breaks down its hook, pacing and structure, then writes you an
              original script built the same way.
            </p>
            <PasteBox />
            <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-faint">
              <span className="inline-flex items-center gap-1.5">
                <Icon name="yt" />
                YouTube
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="ig" />
                Instagram
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon name="upload" />
                or upload MP4 / MOV
              </span>
            </div>
          </div>
          <HeroDemo />
        </section>
      </main>

      {/* Outputs bento */}
      <section id="product" className="scroll-mt-16 border-t border-line py-16 sm:py-[88px]">
        <div className={wrap}>
          <SectionHead eyebrow="One upload, five outputs" title="Everything a short-form channel needs from a single video">
            Start with a script, then turn the same source into clips, a story video, B-roll and a carousel without
            re-uploading.
          </SectionHead>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-6">
            <Cell
              className="md:col-span-2 lg:col-span-4"
              title="Scripts that match the original's structure"
              art={
                <div className="grid gap-2">
                  {[92, 64, 84, 70, 40].map((w, i) => (
                    <div
                      key={i}
                      className={
                        i === 1
                          ? "h-[9px] rounded bg-accent-soft outline outline-1 outline-[rgba(242,184,75,.35)]"
                          : "h-[9px] rounded bg-surface-3"
                      }
                      style={{ width: `${w}%` }}
                    />
                  ))}
                </div>
              }
            >
              We transcribe the source, map its beats and rewrite every line in your style. Nothing is copied.
            </Cell>
            <Cell
              className="lg:col-span-2"
              title="Clips"
              art={
                <div className="flex gap-2">
                  {(
                    [
                      ["t2", "0:21"],
                      ["t4", "0:34"],
                      ["t6", "0:17"],
                    ] as [Tone, string][]
                  ).map(([t, d]) => (
                    <Thumb key={t} tone={t} figure className="aspect-[9/16] flex-1 rounded-lg">
                      <small className="absolute bottom-1.5 left-1.5 z-[2] font-mono text-[10px] text-white">{d}</small>
                    </Thumb>
                  ))}
                </div>
              }
            >
              Find the strongest moments, reframe to 9:16 with face tracking, add captions.
            </Cell>
            <Cell
              className="lg:col-span-2"
              title="Story Studio"
              art={
                <div className="grid grid-cols-3 gap-1.5">
                  {(["t7", "t3", "t5", "t6", "t1", "t8"] as Tone[]).map((t) => (
                    <Thumb key={t} tone={t} className="aspect-square rounded-md" />
                  ))}
                </div>
              }
            >
              Turn an idea into a narrated video with generated scenes and voiceover.
            </Cell>
            <Cell
              className="lg:col-span-2"
              title="AI B-roll"
              art={
                <div className="grid gap-1.5">
                  <div className="flex h-[22px] gap-1">
                    {(
                      [
                        ["t2", 3],
                        ["t5", 2],
                        ["t7", 4],
                      ] as [Tone, number][]
                    ).map(([t, f]) => (
                      <span key={t} className="rounded" style={{ flex: f, background: TONES[t] }} />
                    ))}
                  </div>
                  <div className="flex h-[22px] gap-1">
                    <span className="flex-1 rounded bg-surface-3" />
                  </div>
                </div>
              }
            >
              Cutaways matched to each line of your script, rendered on our servers.
            </Cell>
            <Cell
              className="md:col-span-2 lg:col-span-2"
              title="Instagram posts"
              art={
                <div className="flex gap-1.5">
                  {(["t8", "t3", "t4", "t6"] as Tone[]).map((t) => (
                    <Thumb key={t} tone={t} className="aspect-[4/5] flex-1 rounded-lg" />
                  ))}
                </div>
              }
            >
              Carousel slides and captions written from the same idea.
            </Cell>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 border-t border-line py-16 sm:py-[88px]">
        <div className={wrap}>
          <SectionHead eyebrow="How it works" title="From link to script in about a minute" />
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="grid content-start gap-2.5 border-t border-line-strong pt-[18px]">
                <span className="font-mono text-xs text-faint">{s.n}</span>
                <h3 className="text-lg font-semibold tracking-[-0.02em]">{s.title}</h3>
                <p className="text-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-line py-20 text-center sm:py-24">
        <div className={wrap}>
          <h2 className="mb-3.5 text-balance text-[clamp(30px,4vw,48px)] font-semibold tracking-[-0.02em]">
            Your next video starts with a link
          </h2>
          <p className="mb-7 text-muted">Free to start. No card required.</p>
          <Show when="signed-out">
            <Link href="/sign-up" className={`${btnPrimary} ${btnMd}`}>
              Get started
              <Icon name="arrow" />
            </Link>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard/new" className={`${btnPrimary} ${btnMd}`}>
              Start a new script
              <Icon name="arrow" />
            </Link>
          </Show>
        </div>
      </section>

      <footer className="border-t border-line pb-[calc(28px+env(safe-area-inset-bottom,0px))] pt-7 text-[13px] text-faint">
        <div className={`${wrap} flex flex-wrap justify-between gap-4`}>
          <span>© {new Date().getFullYear()} VidoScript</span>
          <span>Made for short-form creators</span>
        </div>
      </footer>
    </div>
  );
}
