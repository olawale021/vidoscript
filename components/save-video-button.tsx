"use client";

import { useState } from "react";
import { Check, Download, Loader2, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

// Saving an MP4 that lives on another domain (R2):
// - Phones: fetch the file, then open the share sheet (Save Video → Photos /
//   Gallery, or share straight to TikTok / Instagram). iOS only allows the
//   share sheet right after a tap, so it's two taps: "Get video" → "Save".
// - Desktop (or no share support): a link whose URL forces a download
//   (Content-Disposition: attachment, see convex/r2.ts downloadUrl).
export function SaveVideoButton({
  downloadUrl,
  fileName,
  label = "Download MP4",
  size = "sm",
  variant = "outline",
}: {
  downloadUrl: string;
  fileName: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default";
}) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "fetching" | "ready" | "done" | "error">("idle");

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (!canShareFiles) {
    return (
      <a href={downloadUrl} download={fileName}>
        <Button size={size} variant={variant}>
          <Download size={14} className="mr-1" /> {label}
        </Button>
      </a>
    );
  }

  const fetchFile = async () => {
    setState("fetching");
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const f = new File([blob], fileName, { type: "video/mp4" });
      if (!navigator.canShare({ files: [f] })) throw new Error("cannot share");
      setFile(f);
      setState("ready");
    } catch {
      // Sharing not possible: fall back to the forced-download link.
      setState("error");
      window.location.href = downloadUrl;
    }
  };

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: fileName.replace(/\.mp4$/, "") });
      setState("done");
    } catch {
      setState("ready"); // user closed the sheet — let them try again
    }
  };

  if (state === "ready" || state === "done") {
    return (
      <Button size={size} variant="default" onClick={share}>
        {state === "done" ? <Check size={14} className="mr-1" /> : <Share size={14} className="mr-1" />}
        {state === "done" ? "Saved / shared" : "Save or share video"}
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} onClick={fetchFile} disabled={state === "fetching"}>
      {state === "fetching" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Download size={14} className="mr-1" />}
      {state === "fetching" ? "Getting video…" : label}
    </Button>
  );
}
