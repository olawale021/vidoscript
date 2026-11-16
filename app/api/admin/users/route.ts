import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin";

// Admin-only: resolve Clerk user ids to name / email for the admin pages.
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string" && x.startsWith("user_")).slice(0, 100)
    : [];
  if (ids.length === 0) return NextResponse.json({ users: [] });

  const client = await clerkClient();
  const { data } = await client.users.getUserList({ userId: ids, limit: ids.length });
  return NextResponse.json({
    users: data.map((u) => ({
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null,
      email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
      imageUrl: u.imageUrl ?? null,
    })),
  });
}
