import { DashboardSidebar, MobileTopBar } from "@/components/dashboard-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // 100dvh tracks the visible viewport on mobile browsers (address bar).
    <div className="h-dvh bg-black text-white flex flex-col md:flex-row overflow-hidden">
      <DashboardSidebar />
      <MobileTopBar />
      <main
        className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 md:px-6 py-4 md:py-5 bg-black"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
    </div>
  );
}
