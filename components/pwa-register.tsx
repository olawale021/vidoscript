"use client";

import { useEffect } from "react";

// Registers the service worker (public/sw.js) in production builds only, so
// local `next dev` hot reload is never served stale files.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
