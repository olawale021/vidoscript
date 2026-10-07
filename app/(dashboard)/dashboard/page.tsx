"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Trash2,
  Play,
  AlertTriangle,
  FolderOpen,
  FileText,
  Type,
  Clapperboard,
  Timer,
  Feather,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function DashboardPage() {
  const router = useRouter();
  const projects = useQuery(api.projects.list);
  const stats = useQuery(api.projects.stats);
  const deleteProjectMut = useMutation(api.projects.remove);

  const loading = projects === undefined;
  const continueProject = projects?.find((p) => p.status === "ready");

  const statTiles = [
    { icon: FolderOpen, label: "Projects", value: stats?.projects },
    { icon: Type, label: "Words written", value: stats?.wordsWritten },
    { icon: Timer, label: "Minutes transcribed", value: stats?.minutesTranscribed },
    { icon: Clapperboard, label: "B-roll renders", value: stats?.rendersDone },
    { icon: Feather, label: "Style samples", value: stats?.styleSamples },
  ];

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await deleteProjectMut({ id: id as Id<"projects"> });
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-medium">Dashboard</h1>
          <p className="text-base text-neutral-500 mt-0.5">
            Turn videos into scripts that sound like you.
          </p>
        </div>
        <Link href="/dashboard/new">
          <Button size="sm">
            <Plus className="mr-1.5" size={15} /> New Project
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {statTiles.map(({ icon: Icon, label, value }) => (
          <div key={label} className="border border-neutral-800 rounded-lg px-4 py-3.5 bg-neutral-900/30">
            <div className="flex items-center gap-1.5 text-neutral-500 mb-1.5">
              <Icon size={13} />
              <span className="text-xs">{label}</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums">
              {value === undefined ? "—" : value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Continue where you left off */}
      {continueProject && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold tracking-widest uppercase text-neutral-500 mb-3">
            Continue where you left off
          </h2>
          <Link
            href={`/dashboard/project/${continueProject.id}`}
            className="group flex items-center gap-4 border border-neutral-800 hover:border-neutral-600 rounded-lg p-4 transition bg-neutral-900/30"
          >
            <div className="w-16 h-16 rounded-md bg-neutral-800 overflow-hidden flex items-center justify-center flex-shrink-0">
              {continueProject.videoUrl ? (
                <video src={continueProject.videoUrl} preload="metadata" muted className="w-full h-full object-cover" />
              ) : (
                <FileText size={20} className="text-neutral-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-medium truncate">{continueProject.title}</p>
              <p className="text-sm text-neutral-500">
                {continueProject.wordCount || 0} words · edited {timeAgo(continueProject.updatedAt)}
              </p>
            </div>
            <ArrowRight size={18} className="text-neutral-600 group-hover:text-white transition flex-shrink-0" />
          </Link>
        </div>
      )}

      {/* Projects */}
      <h2 className="text-xs font-semibold tracking-widest uppercase text-neutral-500 mb-3">
        Projects
      </h2>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-neutral-500" size={20} />
        </div>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-neutral-800 rounded-lg py-16 text-center">
          <p className="text-neutral-400 mb-1">No projects yet</p>
          <p className="text-sm text-neutral-600 mb-5">
            Upload a video and get an original script in its style.
          </p>
          <Link href="/dashboard/new">
            <Button size="sm" variant="outline">
              <Plus className="mr-1.5" size={14} /> Create your first project
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/project/${p.id}`}
              className="group border border-neutral-800 hover:border-neutral-600 rounded-lg overflow-hidden transition bg-neutral-900/30"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-neutral-900 flex items-center justify-center overflow-hidden">
                {p.videoUrl ? (
                  <video src={p.videoUrl} preload="metadata" muted className="w-full h-full object-cover" />
                ) : (
                  <FileText size={22} className="text-neutral-700" />
                )}
                {p.status === "ready" && p.videoUrl && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition bg-black/30">
                    <Play size={20} className="text-white" fill="white" />
                  </div>
                )}
                {p.status === "processing" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <span className="shimmer text-sm font-medium capitalize">
                      {p.progressStep || "Processing"}…
                    </span>
                  </div>
                )}
                {p.status === "failed" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <span className="text-red-400 text-sm flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Failed
                    </span>
                  </div>
                )}
                <button
                  onClick={(e) => handleDelete(p.id, e)}
                  title="Delete project"
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-neutral-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {/* Meta */}
              <div className="px-3 py-2.5">
                <p className="text-sm font-medium truncate">{p.title}</p>
                <p className="text-xs text-neutral-500 mt-0.5">
                  {p.status === "ready"
                    ? `${p.wordCount || 0} words · ${timeAgo(p.updatedAt)}`
                    : p.status === "processing"
                    ? "in progress"
                    : "tap to retry"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
