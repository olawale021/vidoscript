import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-neutral-800">
        <div className="max-w-5xl mx-auto px-6 py-5 flex justify-between items-center">
          <div className="text-xl font-medium tracking-tight">VidoScript</div>
          <nav className="flex items-center gap-6">
            <a href="#features" className="text-base text-neutral-400 hover:text-white transition">Features</a>
            <a href="#pricing" className="text-base text-neutral-400 hover:text-white transition">Pricing</a>
            <Show when="signed-out">
              <SignInButton mode="modal" fallbackRedirectUrl="/dashboard">
                <button className="text-base text-neutral-300 hover:text-white transition">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal" fallbackRedirectUrl="/dashboard">
                <button className="bg-white text-black px-4 py-1.5 rounded-md text-base font-medium hover:bg-neutral-200 transition">
                  Get Started
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="text-base text-neutral-300 hover:text-white transition">
                Dashboard
              </Link>
              <UserButton />
            </Show>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6">
        {/* Hero */}
        <section className="pt-32 pb-24 text-center">
          <h1 className="text-5xl sm:text-6xl font-medium tracking-tight leading-tight mb-5">
            Turn any video into<br />a new, original script
          </h1>
          <p className="text-xl text-neutral-400 max-w-lg mx-auto mb-10 leading-relaxed">
            Upload a video and get a script that matches the style,
            tone, and structure — without copying.
          </p>
          <div className="flex gap-3 justify-center">
            <a
              href="/sign-up"
              className="bg-white text-black px-6 py-2.5 rounded-md text-base font-medium hover:bg-neutral-200 transition"
            >
              Get Started
            </a>
            <a
              href="#features"
              className="border border-neutral-700 text-neutral-300 px-6 py-2.5 rounded-md text-base font-medium hover:text-white hover:border-neutral-500 transition"
            >
              Learn More
            </a>
          </div>
        </section>

        {/* How It Works */}
        <section id="features" className="py-24 border-t border-neutral-800">
          <h2 className="text-base font-medium text-neutral-500 uppercase tracking-wider mb-12 text-center">How it works</h2>
          <div className="grid md:grid-cols-3 gap-12">
            {[
              { step: "01", title: "Upload", desc: "Drop a video file or paste a link. MP4, MOV, and more." },
              { step: "02", title: "Analyze", desc: "AI transcribes and detects structure, tone, pacing, and hooks." },
              { step: "03", title: "Generate", desc: "Get an original script that captures the same style." },
            ].map((item) => (
              <div key={item.step}>
                <span className="text-sm text-neutral-500 font-mono">{item.step}</span>
                <h3 className="text-lg font-medium mt-2 mb-2">{item.title}</h3>
                <p className="text-base text-neutral-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 border-t border-neutral-800">
          <h2 className="text-base font-medium text-neutral-500 uppercase tracking-wider mb-12 text-center">Pricing</h2>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <div className="border border-neutral-800 rounded-lg p-8">
              <h3 className="text-base font-medium text-neutral-400 mb-1">Free</h3>
              <p className="text-4xl font-medium mb-6">$0<span className="text-base text-neutral-500 ml-1">/mo</span></p>
              <ul className="space-y-3 text-base text-neutral-400 mb-8">
                <li>3 videos per month</li>
                <li>Up to 2 minutes</li>
                <li>Basic generation</li>
              </ul>
              <a href="/sign-up" className="block text-center border border-neutral-700 py-2.5 rounded-md text-base text-neutral-300 hover:text-white hover:border-neutral-500 transition">
                Get Started
              </a>
            </div>
            <div className="border border-neutral-700 rounded-lg p-8">
              <h3 className="text-base font-medium text-white mb-1">Pro</h3>
              <p className="text-4xl font-medium mb-6">$19<span className="text-base text-neutral-500 ml-1">/mo</span></p>
              <ul className="space-y-3 text-base text-neutral-300 mb-8">
                <li>Unlimited videos</li>
                <li>Up to 30 minutes</li>
                <li>Multiple variations</li>
                <li>Tone adjustments</li>
                <li>Priority processing</li>
              </ul>
              <a href="/sign-up" className="block text-center bg-white text-black py-2.5 rounded-md text-base font-medium hover:bg-neutral-200 transition">
                Start Free Trial
              </a>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 border-t border-neutral-800 text-center">
          <h2 className="text-3xl font-medium mb-3">Ready to start?</h2>
          <p className="text-neutral-400 text-base mb-8">Create original scripts in minutes.</p>
          <a
            href="/sign-up"
            className="bg-white text-black px-6 py-2.5 rounded-md text-base font-medium hover:bg-neutral-200 transition inline-block"
          >
            Get Started
          </a>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-800 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center text-sm text-neutral-500">
          <p>&copy; 2025 VidoScript</p>
        </div>
      </footer>
    </div>
  );
}
