"use client";

import { useState } from "react";
import { Sparkles, Loader2, Copy, Download, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScriptDisplay } from "@/components/script-display";

interface GenerateFromCaptionProps {
  caption: string;
}

export function GenerateFromCaption({ caption }: GenerateFromCaptionProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/instagram/generate-from-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      const data = await res.json();
      setScript(data.script);
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!script) return;
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!script) return;
    const blob = new Blob([script], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "script.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRegenerateSection = async (section: {
    type: string;
    label?: string;
    index: number;
  }) => {
    if (!script || !analysis) return "";

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: caption,
        analysis,
        currentScript: script,
        section: { type: section.type, label: section.label },
      }),
    });

    if (!res.ok) throw new Error("Failed to regenerate section");
    const data = await res.json();
    return data.sectionContent;
  };

  if (!script) {
    return (
      <>
        <Button
          onClick={generate}
          disabled={loading}
          size="sm"
          variant="outline"
          className="text-base font-semibold h-8 gap-1.5 border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              Generating script...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate Script
            </>
          )}
        </Button>
        {error && <p className="text-base text-red-400 mt-2">{error}</p>}
      </>
    );
  }

  return (
    <div className="mt-3 border border-neutral-700 rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-800 border-b border-neutral-700">
        <span className="text-base font-semibold text-neutral-300 flex items-center gap-1.5">
          <Sparkles size={14} />
          Generated Script
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-sm font-medium text-neutral-400 hover:text-white"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-7 px-2 text-sm font-medium text-neutral-400 hover:text-white"
          >
            <Download size={12} />
            Download
          </Button>
        </div>
      </div>
      <ScriptDisplay
        script={script}
        onChange={setScript}
        onRegenerateSection={handleRegenerateSection}
      />
    </div>
  );
}
