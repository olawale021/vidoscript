import { DashboardSidebar, MobileTabBar, MobileTopBar } from "@/components/dashboard-sidebar";
import { CommandPalette } from "@/components/command-palette";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // 100dvh tracks the visible viewport on mobile browsers (address bar).
    <div className="h-dvh bg-bg text-fg flex flex-col md:flex-row overflow-hidden">
      <DashboardSidebar />
      <MobileTopBar />
      <main
        className="flex-1 min-w-0 overflow-y-auto overscroll-contain px-4 md:px-6 py-4 md:py-6 bg-bg pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
      <MobileTabBar />
      <CommandPalette />
    </div>
  );
}
