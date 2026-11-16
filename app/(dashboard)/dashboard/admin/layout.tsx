import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { AdminTabs } from "./_components/admin-tabs";
import { AuthReady } from "./_components/auth-ready";

// Admin access depends on who is signed in, so never prerender these pages.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) notFound();
  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Admin</h1>
          <p className="text-sm text-neutral-500">Server capacity, AI spend and users. Visible only to admins.</p>
        </div>
        <AdminTabs />
      </div>
      <AuthReady>{children}</AuthReady>
    </div>
  );
}
