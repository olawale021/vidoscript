import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { Eyebrow } from "@/components/ui/kit";
import { AdminTabs, HealthPill } from "./_components/admin-tabs";
import { AuthReady } from "./_components/auth-ready";
import "./_components/admin.css";

// Admin access depends on who is signed in, so never prerender these pages.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) notFound();
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>Admin · only you can see this</Eyebrow>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Operations</h1>
        </div>
        <HealthPill />
      </header>
      <AdminTabs />
      <AuthReady>{children}</AuthReady>
    </div>
  );
}
