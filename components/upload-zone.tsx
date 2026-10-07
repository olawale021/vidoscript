"use client";

import { useState, useCallback } from "react";
import { Upload, Link as LinkIcon, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  onYouTubeSubmit: (url: string) => void;
  isUploading?: boolean;
}

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

export function UploadZone({ onFileSelect, onYouTubeSubmit, isUploading }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "youtube">("upload");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith("video/") || file.name.endsWith(".mp4") || file.name.endsWith(".mov"))) {
      if (file.size > MAX_FILE_SIZE) {
        setError("File size exceeds 300MB limit");
        return;
      }
      setError(null);
      setSelectedFile(file);
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setError("File size exceeds 300MB limit");
        return;
      }
      setError(null);
      setSelectedFile(file);
      onFileSelect(file);
    }
  };

  const handleYouTubeSubmit = () => {
    if (youtubeUrl.trim()) {
      onYouTubeSubmit(youtubeUrl.trim());
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
  };

  return (
    <div className="space-y-4">
      {/* Tab buttons */}
      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab("upload")}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition",
            activeTab === "upload"
              ? "bg-white text-black"
              : "text-neutral-500 hover:text-white"
          )}
        >
          Upload
        </button>
        <button
          onClick={() => setActiveTab("youtube")}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition",
            activeTab === "youtube"
              ? "bg-white text-black"
              : "text-neutral-500 hover:text-white"
          )}
        >
          YouTube
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      {activeTab === "upload" ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "border border-dashed rounded-lg p-10 text-center transition",
            isDragging
              ? "border-white bg-white/5"
              : "border-neutral-800 hover:border-neutral-700",
            isUploading && "pointer-events-none opacity-40"
          )}
        >
          {selectedFile ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2">
                <span className="text-base">{selectedFile.name}</span>
                <button
                  onClick={clearFile}
                  className="text-neutral-600 hover:text-white transition"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-sm text-neutral-600">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            </div>
          ) : (
            <>
              <Upload className="mx-auto text-neutral-600 mb-3" size={18} />
              <p className="text-base mb-1">
                Drop your video here, or{" "}
                <label className="text-white cursor-pointer hover:underline">
                  browse
                  <input
                    type="file"
                    className="hidden"
                    accept="video/*,.mp4,.mov,.avi,.mkv"
                    onChange={handleFileChange}
                  />
                </label>
              </p>
              <p className="text-sm text-neutral-700">
                MP4, MOV, AVI, MKV up to 300MB
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="border border-neutral-800 rounded-lg p-6 space-y-3">
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              className="flex-1"
              disabled={isUploading}
            />
            <Button size="sm" onClick={handleYouTubeSubmit} disabled={!youtubeUrl.trim() || isUploading}>
              {isUploading ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                "Fetch"
              )}
            </Button>
          </div>
          <p className="text-sm text-neutral-600">
            Paste a YouTube URL to extract and analyze
          </p>
        </div>
      )}
    </div>
  );
}
