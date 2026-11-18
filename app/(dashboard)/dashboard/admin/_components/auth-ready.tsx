"use client";

import { useConvexAuth } from "convex/react";
import { Loader2 } from "lucide-react";

// On a full page load, Convex queries can run before Clerk's token reaches
// Convex. Admin queries throw when unauthenticated, so hold the admin pages
// until Convex confirms the session.
export function AuthReady({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading || !isAuthenticated) {
    return <Loader2 className="animate-spin text-faint" />;
  }
  return <>{children}</>;
}
