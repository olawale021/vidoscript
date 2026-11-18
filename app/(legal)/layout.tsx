import Link from "next/link";

// Public legal pages (privacy, terms, data deletion). Needed by Meta, Google
// and TikTok app reviews; reachable without signing in (see proxy.ts).

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <Link href="/" className="text-[17px] font-bold tracking-tight">
          VidoScript
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link href="/data-deletion" className="hover:text-fg">
            Data deletion
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_p]:leading-relaxed [&_p]:text-muted [&_ul]:mb-3 [&_ul]:grid [&_ul]:gap-1 [&_ul]:text-muted">
        {children}
      </main>
    </div>
  );
}
