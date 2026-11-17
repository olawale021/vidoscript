import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "VidoScript - Turn Videos Into Scripts",
  description: "Upload any video and instantly generate original, high-quality scripts that match the style and structure of the original content.",
  applicationName: "VidoScript",
  appleWebApp: {
    capable: true,
    title: "VidoScript",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // let the app draw under the notch; layouts pad with safe-area insets
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&display=swap" rel="stylesheet" />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject
          attributes into <body> before hydration; only this element's
          attribute mismatches are silenced, not its children. */}
      <body className="antialiased bg-black" suppressHydrationWarning>
        {/* Sign-in stays inside the app (important for the installed PWA,
            which would otherwise leave to accounts.vidoscript.app). */}
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">
          <ConvexClientProvider>
            {children}
            <PwaRegister />
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
