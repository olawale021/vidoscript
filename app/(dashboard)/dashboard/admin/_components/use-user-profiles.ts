"use client";

import { useEffect, useState } from "react";

export type Profile = { id: string; name: string | null; email: string | null; imageUrl: string | null };

// Resolves Clerk user ids to name/email via the admin-only API route.
export function useUserProfiles(ids: string[]) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const key = [...new Set(ids)].filter((id) => id && id !== "anonymous").sort().join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: key.split(",") }),
    })
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d: { users: Profile[] }) => {
        if (cancelled) return;
        setProfiles(Object.fromEntries(d.users.map((u) => [u.id, u])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return profiles;
}
