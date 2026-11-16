"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { AlertCircle, CheckCircle2, Film, Link2, Loader2, Scissors, Upload, Youtube } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusLine } from "./_components/status";

const MAX_BYTES = 2 * 1024 ** 3;

// PUT straight to R2 with progress (fetch has no upload progress).
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection (or the bucket's CORS settings)"));
    xhr.send(file);
  });
}

export default function ClipsPage() {
  const sources = useQuery(api.clips.list);
  const createUpload = useMutation(api.clips.createUpload);
  const markUploaded = useMutation(api.clips.markUploaded);
  const createFromUrl = useMutation(api.clips.createFromUrl);
  const confirmDownload = useMutation(api.clips.confirmDownload);
  const removeSource = useMutation(api.clips.remove);
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [link, setLink] = useState("");
  const [rights, setRights] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const submitLink = async () => {
    setError(null);
    setLinkBusy(true);
    try {
      await createFromUrl({ url: link, rightsConfirmed: rights });
      setLink("");
      setRights(false);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
    } finally {
      setLinkBusy(false);
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith("video/")) return setError("Please choose a video file.");
      if (file.size > MAX_BYTES) return setError("Videos up to 2 GB are supported.");
      setUpload({ name: file.name, pct: 0 });
      try {
        const { sourceId, url } = await createUpload({
          title: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        await putWithProgress(url, file, (pct) => setUpload({ name: file.name, pct }));
        await markUploaded({ sourceId });
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e));
      } finally {
        setUpload(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [createUpload, markUploaded]
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
          <Scissors size={22} /> Clips
        </h1>
        <p className="text-sm text-neutral-500">
          Upload a long video and get the best short clips, picked by AI from the transcript.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-neutral-800 p-1 bg-neutral-950 w-fit">
        {[
          { key: "upload" as const, label: "Upload video", icon: Upload },
          { key: "link" as const, label: "Paste YouTube link", icon: Youtube },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm font-medium transition inline-flex items-center gap-1.5",
              mode === key ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-white"
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {mode === "link" ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-6 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…  or youtu.be/…  or /shorts/…"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 pl-9 pr-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-600"
              />
            </div>
            <Button onClick={submitLink} disabled={linkBusy || !link.trim() || !rights}>
              {linkBusy ? <Loader2 size={15} className="animate-spin" /> : "Get clips"}
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm text-neutral-400 cursor-pointer">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5 accent-sky-400" />
            <span>
              I own this video or have permission to use it. Clipping other people&apos;s videos without permission can
              break YouTube&apos;s terms and copyright law.
            </span>
          </label>
          <p className="text-xs text-neutral-500">
            Public videos up to 1 hour (longer ones are rejected before anything is charged). Downloading costs about
            $0.02 per minute of video — a 10-minute video ≈ $0.20. Kept for 30 days.
          </p>
        </div>
      ) : (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f && !upload) start(f);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-10 text-center transition",
          dragging ? "border-sky-400 bg-sky-400/5" : "border-neutral-800 bg-neutral-950"
        )}
      >
        {upload ? (
          <div className="space-y-3 max-w-md mx-auto">
            <div className="text-sm text-neutral-300 truncate">Uploading {upload.name}</div>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full bg-sky-400 transition-[width]" style={{ width: `${upload.pct}%` }} />
            </div>
            <div className="text-xs text-neutral-500">{upload.pct}% — keep this tab open until it finishes</div>
          </div>
        ) : (
          <>
            <Upload className="mx-auto text-neutral-500" size={28} />
            <p className="mt-3 text-neutral-300">Drop a video here, or</p>
            <Button className="mt-3" onClick={() => inputRef.current?.click()}>
              Choose video
            </Button>
            <p className="mt-3 text-xs text-neutral-500">MP4, MOV or WebM, up to 2 GB. Videos are kept for 30 days.</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && start(e.target.files[0])}
        />
      </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      {(sources ?? [])
        .filter((s) => s.status === "confirm")
        .map((s) => (
          <div key={s._id} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 flex gap-4 items-center flex-wrap">
            {s.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumbnailUrl} alt="" className="w-40 aspect-video object-cover rounded-md flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-neutral-100 font-medium truncate">{s.title}</div>
              {s.channelName && <div className="text-xs text-neutral-500">{s.channelName}</div>}
              <div className="text-sm text-neutral-300 mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>Length <b>{s.durationSec ? `${Math.floor(s.durationSec / 60)}:${String(Math.round(s.durationSec % 60)).padStart(2, "0")}` : "?"}</b></span>
                <span>Download ≈ <b>{s.estimateMb ? (s.estimateMb >= 1000 ? `${(s.estimateMb / 1000).toFixed(1)} GB` : `${s.estimateMb} MB`) : "?"}</b></span>
                <span>Cost ≈ <b>${s.estimateUsd?.toFixed(2) ?? "?"}</b> + transcription ≈ <b>${s.durationSec ? ((s.durationSec / 60) * 0.006).toFixed(2) : "?"}</b></span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => confirmDownload({ sourceId: s._id })}>Download</Button>
              <Button variant="outline" onClick={() => removeSource({ sourceId: s._id })}>Cancel</Button>
            </div>
          </div>
        ))}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-300">Your videos</h2>
        {sources === undefined ? (
          <Loader2 className="animate-spin text-neutral-500" />
        ) : sources.length === 0 ? (
          <div className="text-sm text-neutral-500">No videos yet.</div>
        ) : (
          <ul className="divide-y divide-neutral-900 rounded-lg border border-neutral-800 bg-neutral-950">
            {sources.map((s) => (
              <li key={s._id}>
                <Link
                  href={`/dashboard/clips/${s._id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition"
                >
                  {s.status === "ready" ? (
                    <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                  ) : s.status === "failed" ? (
                    <AlertCircle size={18} className="text-red-400 flex-shrink-0" />
                  ) : (
                    <Film size={18} className="text-neutral-500 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-neutral-200 truncate">{s.title}</div>
                    <StatusLine
                      status={s.status}
                      step={s.step}
                      progress={s.progress}
                      error={s.error}
                      clipCount={s.clipCount}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
