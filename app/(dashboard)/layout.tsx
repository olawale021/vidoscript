import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen bg-black text-white flex overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto px-6 py-5 bg-black">
        {children}
      </main>
    </div>
  );
}
