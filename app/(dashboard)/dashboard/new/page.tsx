"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload, FileVideo, X, Loader2, Lightbulb, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

export default function NewProjectPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"video" | "idea">("video");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [userPrompt, setUserPrompt] = useState("");
  const [idea, setIdea] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateUploadUrlMut = useMutation(api.projects.generateUploadUrl);
  const createDraftMut = useMutation(api.projects.createDraft);

  const acceptFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith("video/") && !f.type.startsWith("audio/")) {
      setError("File must be a video or audio file");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError("File size exceeds 300MB limit");
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload once (browser → Convex), create the project immediately, and hand off
  // to the project workspace, which runs the pipeline and shows live progress.
  const start = async () => {
    if (!file || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrlMut();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed — please try again");
      const { storageId } = await res.json();

      const id = await createDraftMut({
        title: file.name.replace(/\.[^/.]+$/, ""),
        videoStorageId: storageId,
        userPrompt: userPrompt.trim() || null,
        model: "gemini",
      });
      router.push(`/dashboard/project/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the project");
      setIsStarting(false);
    }
  };

  // Idea mode: no upload — the Style Bank carries the voice, the notes the content.
  const startFromIdea = async () => {
    const notes = idea.trim();
    if (!notes || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const firstWords = notes.split(/\s+/).slice(0, 6).join(" ");
      const id = await createDraftMut({
        title: firstWords.length < notes.length ? `${firstWords}…` : firstWords,
        idea: notes,
        model: "gemini",
      });
      router.push(`/dashboard/project/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the project");
      setIsStarting(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <Link
          href="/dashboard"
          className="inline-flex items-center text-sm text-neutral-500 hover:text-white mb-8 transition"
        >
          <ArrowLeft size={14} className="mr-1.5" /> Back
        </Link>

        <h1 className="text-3xl font-medium tracking-tight mb-2">New project</h1>
        <p className="text-neutral-500 text-base mb-6">
          Start from a video whose style you want to match — or just a topic or rough notes,
          written in your Style Bank voice.
        </p>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2 mb-6">
          {([
            { key: "video" as const, icon: Film, label: "From video", desc: "Match an existing video's style" },
            { key: "idea" as const, icon: Lightbulb, label: "From idea", desc: "Topic or rough notes → script" },
          ]).map(({ key, icon: Icon, label, desc }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              disabled={isStarting}
              className={cn(
                "rounded-lg border p-3.5 text-left transition",
                mode === key
                  ? "border-white bg-white/5"
                  : "border-neutral-800 hover:border-neutral-600"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={15} className={mode === key ? "text-white" : "text-neutral-500"} />
                <span className={cn("text-sm font-medium", mode === key ? "text-white" : "text-neutral-300")}>
                  {label}
                </span>
              </div>
              <p className="text-xs text-neutral-500">{desc}</p>
            </button>
          ))}
        </div>

        {error && (
          <div className="border border-red-900/50 bg-red-950/30 rounded-md p-3 mb-6 text-red-300 text-sm">
            {error}
          </div>
        )}

        {mode === "idea" ? (
          <div>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={isStarting}
              rows={8}
              placeholder={`A topic, or paste your rough notes — bullet points, half-sentences, anything.\n\ne.g. "3 mistakes new lifters make in the gym"\nor\n"- built an ML model for world cup\n- trained on 50k matches\n- france 56% vs morocco\n- mention the 2022 qatar semifinal"`}
              className="w-full bg-transparent border border-neutral-700 rounded-lg px-3.5 py-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-500 resize-none leading-relaxed"
            />
            <p className="text-xs text-neutral-600 mt-2 mb-3">
              Your facts and numbers are kept exactly — nothing gets invented. The script is written
              in your selected Style Bank voice.
            </p>
            <Button onClick={startFromIdea} disabled={!idea.trim() || isStarting} className="w-full text-base">
              {isStarting ? (
                <>
                  <Loader2 className="mr-1.5 animate-spin" size={15} /> Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </div>
        ) : (
        <>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "w-full border border-dashed rounded-lg p-12 text-center transition-all",
            isDragging ? "border-white bg-white/5" : "border-neutral-700 hover:border-neutral-500"
          )}
        >
          {file ? (
            <div className="space-y-3">
              <FileVideo className="text-neutral-400 mx-auto" size={24} />
              <div className="flex items-center justify-center gap-2">
                <span className="text-base font-medium">{file.name}</span>
                <button
                  onClick={() => setFile(null)}
                  disabled={isStarting}
                  className="text-neutral-500 hover:text-white transition"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-sm text-neutral-400">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
          ) : (
            <>
              <Upload className="text-neutral-400 mx-auto mb-4" size={20} />
              <p className="text-base font-medium mb-1">Drop your video here</p>
              <p className="text-sm text-neutral-400 mb-5">or click to browse</p>
              <label>
                <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                  <span>Choose File</span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept="video/*,audio/*"
                  onChange={(e) => acceptFile(e.target.files?.[0])}
                />
              </label>
              <p className="text-neutral-400 text-sm mt-5">MP4, MOV, MP3, WAV up to 300MB</p>
            </>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-sm text-neutral-400 mb-2">
            How should your script differ? <span className="text-neutral-600">(optional)</span>
          </label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            disabled={isStarting}
            placeholder='e.g. "Make it about Champions League instead of Premier League", "Add 2 more points", or "Make it more funny"'
            className="w-full bg-transparent border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 resize-none min-h-[80px]"
          />
          <Button onClick={start} disabled={!file || isStarting} className="w-full mt-3 text-base">
            {isStarting ? (
              <>
                <Loader2 className="mr-1.5 animate-spin" size={15} /> Uploading…
              </>
            ) : (
              "Create project"
            )}
          </Button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
