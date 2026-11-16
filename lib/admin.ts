import "server-only";
import { currentUser } from "@clerk/nextjs/server";

// Admins: comma-separated emails in ADMIN_EMAILS (server env).
// Convex checks admin separately (convex/admin.ts) via ADMIN_USER_IDS / ADMIN_EMAILS.
export async function isAdmin(): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0) return false;
  const user = await currentUser();
  if (!user) return false;
  return user.emailAddresses.some(
    (e) => e.verification?.status === "verified" && admins.includes(e.emailAddress.toLowerCase())
  );
}
