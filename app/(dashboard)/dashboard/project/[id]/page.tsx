"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Copy,
  Download,
  RefreshCw,
  CheckCircle,
  Send,
  Maximize2,
  Columns2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScriptDisplay, SectionInfo } from "@/components/script-display";
import { AnalysisPanel } from "@/components/analysis-panel";
import { BrollPanel } from "@/components/broll-panel";
import { cn } from "@/lib/utils";
import { transcribeFromUrl } from "@/app/actions/transcribe";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type PipelineStep = "transcribing" | "analyzing" | "generating";

interface Analysis {
  hookType: string;
  tone: string;
  pacing: string;
  structure: { intro: string; body: string[]; cta: string };
  themes: string[];
  sentiment?: string;
  structuredTranscript?: string;
  [key: string]: unknown;
}

const PIPELINE_STEPS: { key: PipelineStep; label: string; desc: string }[] = [
  { key: "transcribing", label: "Transcribing", desc: "Converting speech to text" },
  { key: "analyzing", label: "Analyzing", desc: "Detecting structure and tone" },
  { key: "generating", label: "Generating", desc: "Creating your script" },
];

export default function ProjectWorkspacePage() {
  const params = useParams();
  const projectId = params.id as Id<"projects">;
  const project = useQuery(api.projects.get, { id: projectId });

  const savePipelineMut = useMutation(api.projects.savePipeline);
  const updateProjectMut = useMutation(api.projects.update);

  // Local editing state (hydrated once from the project record)
  const [transcript, setTranscript] = useState("");
  const [segments, setSegments] = useState<{ start: number; end: number; text: string }[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [generatedScript, setGeneratedScript] = useState("");
  const [selectedTone, setSelectedTone] = useState("");
  const [selectedModel, setSelectedModel] = useState<"gemini" | "gpt4o">("gemini");
  const [userPrompt, setUserPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  // Chat history starts collapsed so the script stays readable; auto-expands on send.
  const [chatOpen, setChatOpen] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<"split" | "left" | "right">("split");

  // Pipeline (for projects still processing)
  const [pipelineStep, setPipelineStep] = useState<PipelineStep | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const hydrated = useRef(false);
  const pipelineStarted = useRef(false);

  // Style Bank
  const [styleScope, setStyleScope] = useState<string>(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("vidoscript_style_scope") || "auto"
      : "auto"
  );
  const styleGroups = useQuery(api.styleBank.groups) ?? [];
  const resolvedStyle = styleScope === "auto" ? styleGroups[0]?.name ?? "off" : styleScope;
  const styleSamples =
    useQuery(
      api.styleBank.forGeneration,
      resolvedStyle === "off" ? "skip" : { group: resolvedStyle }
    ) ?? [];
  const styleSamplesRef = useRef(styleSamples);
  styleSamplesRef.current = styleSamples;
  const pickStyle = (v: string) => {
    setStyleScope(v);
    localStorage.setItem("vidoscript_style_scope", v);
  };
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate local editing state once the project arrives
  useEffect(() => {
    if (!project || hydrated.current) return;
    hydrated.current = true;
    setTranscript(project.transcript);
    setSegments(project.segments || []);
    setAnalysis(
      project.analysis && Object.keys(project.analysis).length > 0
        ? (project.analysis as Analysis)
        : null
    );
    setGeneratedScript(project.script);
    setChatMessages((project.chat || []) as { role: "user" | "assistant"; content: string }[]);
    setSelectedTone(project.tone || "");
    setSelectedModel((project.model as "gemini" | "gpt4o") || "gemini");
    setUserPrompt(project.userPrompt || "");
  }, [project]);

  // Run (or resume) the pipeline for processing projects. Each stage's output is
  // saved to Convex, so a refresh resumes from the last completed stage.
  useEffect(() => {
    if (!project || pipelineStarted.current) return;
    if ((project.status ?? "ready") !== "processing") return;
    pipelineStarted.current = true;
    void runPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const runPipeline = async () => {
    if (!project) return;
    setPipelineError(null);
    try {
      const model = (project.model as "gemini" | "gpt4o") || "gemini";
      let tr = project.transcript;
      let segs = project.segments || [];

      if (!tr) {
        setPipelineStep("transcribing");
        if (!project.videoUrl) throw new Error("No uploaded file found for this project");
        const t = await transcribeFromUrl(project.videoUrl);
        if ("error" in t) throw new Error(t.error);
        tr = t.transcript;
        segs = t.segments || [];
        setTranscript(tr);
        setSegments(segs);
        await savePipelineMut({ id: projectId, transcript: tr, segments: segs, progressStep: "analyzing" });
      }

      let an =
        project.analysis && Object.keys(project.analysis).length > 0
          ? (project.analysis as Analysis)
          : null;
      if (!an) {
        setPipelineStep("analyzing");
        const wc = tr.split(/\s+/).filter(Boolean).length;
        const durationSeconds = segs.length ? segs[segs.length - 1].end : 0;
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: tr, wordCount: wc, durationSeconds, model }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Analysis failed");
        an = await res.json();
        setAnalysis(an);
        await savePipelineMut({ id: projectId, analysis: an, progressStep: "generating" });
      }

      if (!project.script) {
        setPipelineStep("generating");
        const isIdea = !project.videoStorageId;
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: tr,
            analysis: an,
            topic: project.userPrompt || undefined,
            model,
            styleSamples: styleSamplesRef.current,
            // Idea projects: the "transcript" is the user's notes — generate
            // from them directly, voice carried by the Style Bank.
            ...(isIdea ? { fromIdea: true, idea: tr } : {}),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Generation failed");
        const data = await res.json();
        setGeneratedScript(data.script);
        await savePipelineMut({ id: projectId, script: data.script, status: "ready", error: null });
      } else {
        await savePipelineMut({ id: projectId, status: "ready", error: null });
      }
      setPipelineStep(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Processing failed";
      setPipelineError(msg);
      setPipelineStep(null);
      await savePipelineMut({ id: projectId, status: "failed", error: msg }).catch(() => {});
    }
  };

  const retryPipeline = async () => {
    setPipelineError(null);
    await savePipelineMut({ id: projectId, status: "processing", error: null });
    pipelineStarted.current = false; // the status change re-triggers the effect
  };

  // Debounced autosave of edits (script, chat, tone)
  useEffect(() => {
    if (!hydrated.current || !project || (project.status ?? "ready") !== "ready") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateProjectMut({
        id: projectId,
        script: generatedScript,
        chat: chatMessages,
        tone: selectedTone || null,
      }).catch((e) => console.error("Autosave failed:", e));
    }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedScript, chatMessages, selectedTone]);

  const regenerateScript = async (toneOverride?: string) => {
    if (!transcript || !analysis) return;
    setIsRegenerating(true);
    setError(null);
    const tone = toneOverride || selectedTone || undefined;
    const isIdea = !project?.videoStorageId;
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          analysis,
          tone,
          topic: userPrompt || undefined,
          model: selectedModel,
          styleSamples,
          history: chatMessages,
          ...(isIdea ? { fromIdea: true, idea: transcript } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Generation failed");
      setGeneratedScript((await res.json()).script);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleToneChange = (tone: string) => {
    setSelectedTone(tone);
    regenerateScript(tone);
  };

  const regenerateSection = async (section: SectionInfo): Promise<string> => {
    if (!transcript || !analysis) throw new Error("Missing data");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        analysis,
        currentScript: generatedScript,
        section: { type: section.type, label: section.label },
        tone: selectedTone || undefined,
        topic: userPrompt || undefined,
        model: selectedModel,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Section regeneration failed");
    return (await res.json()).sectionContent;
  };

  const regenerateSectionVariations = async (section: SectionInfo): Promise<string[]> => {
    if (!transcript || !analysis) throw new Error("Missing data");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        analysis,
        currentScript: generatedScript,
        section: { type: section.type, label: section.label },
        tone: selectedTone || undefined,
        topic: userPrompt || undefined,
        model: selectedModel,
        variations: true,
        variationCount: 5,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Variation generation failed");
    return (await res.json()).variations;
  };

  const chatRewriteSection = async (
    section: SectionInfo,
    sectionContent: string,
    instruction: string
  ): Promise<string[]> => {
    if (!transcript || !analysis) throw new Error("Missing data");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        analysis,
        currentScript: generatedScript,
        section: { type: section.type, label: section.label },
        sectionContent,
        chatInstruction: instruction,
        tone: selectedTone || undefined,
        topic: userPrompt || undefined,
        model: selectedModel,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Chat rewrite failed");
    return (await res.json()).variations;
  };

  // Keep the newest message in view while the history is open
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages, isChatting, chatOpen]);

  const sendChatMessage = async () => {
    const message = chatInput.trim();
    if (!message || isChatting || !transcript || !analysis) return;
    const history = chatMessages;
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatInput("");
    setIsChatting(true);
    setChatOpen(true); // show the conversation while it works
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          analysis,
          currentScript: generatedScript,
          chatRefine: true,
          chatMessage: message,
          history,
          tone: selectedTone || undefined,
          topic: userPrompt || undefined,
          model: selectedModel,
          styleSamples,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat edit failed");
      setGeneratedScript(data.script);
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Updated the script." }]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : "Something went wrong." },
      ]);
    } finally {
      setIsChatting(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const handleCopyTranscript = async () => {
    await navigator.clipboard.writeText(transcript);
    setTranscriptCopied(true);
    setTimeout(() => setTranscriptCopied(false), 2000);
  };
  const handleDownload = () => {
    const blob = new Blob([generatedScript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.title || "script"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render states ──

  if (project === undefined) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="text-neutral-500 animate-spin" size={22} />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-4">
        <p className="text-neutral-400">Project not found.</p>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1.5" size={14} /> Back to dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const status = project.status ?? "ready";

  // Processing / failed
  if (status === "processing" || status === "failed" || pipelineStep) {
    const failed = status === "failed" || pipelineError;
    const activeKey = pipelineStep || (project.progressStep as PipelineStep) || "transcribing";
    const activeIdx = PIPELINE_STEPS.findIndex((s) => s.key === activeKey);
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            {failed ? (
              <AlertTriangle className="text-red-400 mx-auto mb-5" size={24} />
            ) : (
              <Loader2 className="text-neutral-400 animate-spin mx-auto mb-5" size={24} />
            )}
            <h2 className="text-xl font-medium mb-1">{failed ? "Processing failed" : "Processing"}</h2>
            <p className="text-sm text-neutral-400">{project.title}</p>
          </div>

          {failed ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-red-400/90">{pipelineError || project.error}</p>
              <Button size="sm" onClick={retryPipeline}>
                <RefreshCw className="mr-1.5" size={14} /> Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {PIPELINE_STEPS.map(({ key, label, desc }, index) => {
                const isActive = key === activeKey;
                const isComplete = index < activeIdx;
                return (
                  <div
                    key={key}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-md transition-all text-base",
                      isActive && "bg-neutral-800",
                      isComplete && "opacity-50"
                    )}
                  >
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm">
                      {isComplete ? (
                        <CheckCircle size={14} />
                      ) : (
                        <span className={cn("font-mono", isActive ? "text-white" : "text-neutral-600")}>
                          {index + 1}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={cn("text-base", isActive ? "text-white" : "text-neutral-500")}>
                        {label}
                      </p>
                      {isActive && <p className="text-sm text-neutral-400 mt-0.5">{desc}</p>}
                    </div>
                    {isActive && <Loader2 className="text-neutral-500 animate-spin" size={14} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Workspace
  return (
    <div className="w-full flex flex-col h-[calc(100vh-2.5rem)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-neutral-500 hover:text-white transition p-1.5 rounded-md hover:bg-neutral-800"
            title="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-medium mb-0.5">{project.title}</h1>
            <p className="text-sm text-neutral-400">
              {transcript.split(/\s+/).filter(Boolean).length} words transcribed
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckCircle className="mr-1.5" size={14} /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5" size={14} /> Copy
              </>
            )}
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <Download className="mr-1.5" size={14} /> Download
          </Button>
        </div>
      </div>

      {error && (
        <div className="border border-neutral-700 rounded-md p-3 mb-4 text-neutral-400 text-base flex-shrink-0">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6 flex-1 min-h-0">
        {/* Left: Transcript & Analysis */}
        {focus !== "right" && (
          <div className={cn("flex flex-col min-h-0 h-full", focus === "left" ? "lg:col-span-5" : "lg:col-span-2")}>
            <Tabs defaultValue="transcript" className="flex flex-col min-h-0 flex-1">
              <div className="flex items-center gap-2 mb-4 flex-shrink-0">
                <TabsList className="flex-1">
                  <TabsTrigger value="transcript" className="flex-1">
                    {project.videoStorageId ? "Transcript" : "Notes"}
                  </TabsTrigger>
                  <TabsTrigger value="analysis" className="flex-1">Analysis</TabsTrigger>
                </TabsList>
                <button
                  onClick={() => setFocus(focus === "left" ? "split" : "left")}
                  title={focus === "left" ? "Show both panels" : "Focus this panel"}
                  className="flex-shrink-0 p-2 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition"
                >
                  {focus === "left" ? <Columns2 size={16} /> : <Maximize2 size={15} />}
                </button>
              </div>

              <TabsContent value="transcript" className="mt-0 min-h-0 flex-1">
                <Card className="h-full flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 flex-shrink-0">
                    <span className="text-xs font-semibold tracking-widest uppercase text-neutral-500">
                      {project.videoStorageId ? "Original Transcript" : "Your Notes"}
                    </span>
                    <button
                      onClick={handleCopyTranscript}
                      className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white transition"
                    >
                      {transcriptCopied ? (
                        <>
                          <CheckCircle size={12} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
                    <ScriptDisplay
                      script={analysis?.structuredTranscript || transcript}
                      onChange={() => {}}
                      readOnly
                      videoUrl={project.videoUrl}
                      segments={segments}
                      gridLayout={focus === "left"}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="analysis" className="mt-0 min-h-0 flex-1">
                <Card className="h-full flex flex-col overflow-hidden">
                  <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
                    {analysis && <AnalysisPanel analysis={analysis as never} />}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Right: Generated Script + B-roll */}
        {focus !== "left" && (
          <div className={cn("flex flex-col min-h-0 h-full", focus === "right" ? "lg:col-span-5" : "lg:col-span-3")}>
            <Card className="h-full flex flex-col overflow-hidden">
              <Tabs defaultValue="script" className="flex flex-col min-h-0 flex-1">
                <CardHeader className="border-b border-neutral-800 pb-4 flex-shrink-0">
                  <div className="flex justify-between items-center">
                    <div>
                      <CardTitle>Generated Script</CardTitle>
                      <p className="text-sm text-neutral-400 mt-1">Based on your video&apos;s style</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <TabsList>
                        <TabsTrigger value="script">Script</TabsTrigger>
                        <TabsTrigger value="broll">B-roll</TabsTrigger>
                      </TabsList>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => regenerateScript()}
                        disabled={isRegenerating}
                      >
                        <RefreshCw className={cn("mr-1.5", isRegenerating && "animate-spin")} size={14} />
                        {isRegenerating ? "Generating..." : "Regenerate"}
                      </Button>
                      <button
                        onClick={() => setFocus(focus === "right" ? "split" : "right")}
                        title={focus === "right" ? "Show both panels" : "Focus this panel"}
                        className="p-2 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition"
                      >
                        {focus === "right" ? <Columns2 size={16} /> : <Maximize2 size={15} />}
                      </button>
                    </div>
                  </div>
                </CardHeader>

                <TabsContent value="script" className="mt-0 min-h-0 flex-1 flex flex-col">
                  <CardContent className="p-0 flex-1 min-h-0 overflow-y-auto">
                    <ScriptDisplay
                      script={generatedScript}
                      onChange={setGeneratedScript}
                      onRegenerateSection={regenerateSection}
                      onRegenerateSectionVariations={regenerateSectionVariations}
                      onChatRewriteSection={chatRewriteSection}
                      gridLayout={focus === "right"}
                    />
                  </CardContent>

                  {/* Chat composer: refine the whole script; owns model/style/tone */}
                  <div className="border-t border-neutral-800 p-4 flex-shrink-0">
                    {chatMessages.length > 0 && (
                      <button
                        onClick={() => setChatOpen((o) => !o)}
                        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition mb-2"
                      >
                        {chatOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <MessageSquare size={12} />
                        {chatMessages.filter((m) => m.role === "user").length} chat edit
                        {chatMessages.filter((m) => m.role === "user").length === 1 ? "" : "s"}
                        <span className="text-neutral-600">· {chatOpen ? "hide" : "show"}</span>
                      </button>
                    )}
                    {chatMessages.length > 0 && chatOpen && (
                      <div ref={chatScrollRef} className="space-y-2 mb-3 max-h-52 overflow-y-auto">
                        {chatMessages.map((msg, i) => {
                          const isLong = msg.content.length > 220;
                          const expanded = expandedMsgs.has(i);
                          return (
                            <div
                              key={i}
                              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                            >
                              <div
                                className={cn(
                                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                                  msg.role === "user"
                                    ? "bg-white text-black rounded-br-md"
                                    : "bg-neutral-800 text-neutral-300 rounded-bl-md"
                                )}
                              >
                                <span className="whitespace-pre-wrap">
                                  {isLong && !expanded
                                    ? msg.content.slice(0, 220).trimEnd() + "…"
                                    : msg.content}
                                </span>
                                {isLong && (
                                  <button
                                    onClick={() =>
                                      setExpandedMsgs((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(i)) next.delete(i);
                                        else next.add(i);
                                        return next;
                                      })
                                    }
                                    className="block mt-1 text-xs underline underline-offset-2 text-neutral-500 hover:text-neutral-300"
                                  >
                                    {expanded ? "Show less" : "Show more"}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {isChatting && (
                          <div className="flex justify-start">
                            <div className="rounded-2xl rounded-bl-md bg-neutral-800 px-3.5 py-2 text-sm">
                              <span className="shimmer">Rewriting the script…</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Composer */}
                    <div className="rounded-xl border border-neutral-700 bg-neutral-800/50 focus-within:border-neutral-500 transition">
                      <textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={handleChatKeyDown}
                        disabled={isChatting}
                        rows={2}
                        placeholder='Tell AI how to change the script — "Make it about the Champions League", "Add 2 more points", "Make it funnier"'
                        className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none disabled:opacity-50"
                      />
                      <div className="flex items-center gap-1.5 px-2.5 pb-2.5 flex-wrap">
                        <div className="flex items-center bg-neutral-900/70 rounded-full p-0.5">
                          {([
                            { key: "gemini" as const, label: "Gemini" },
                            { key: "gpt4o" as const, label: "GPT-4o" },
                          ]).map(({ key, label }) => (
                            <button
                              key={key}
                              onClick={() => setSelectedModel(key)}
                              disabled={isRegenerating || isChatting}
                              className={cn(
                                "px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-all",
                                selectedModel === key
                                  ? "bg-neutral-600 text-white"
                                  : "text-neutral-500 hover:text-neutral-300",
                                (isRegenerating || isChatting) && "opacity-50 cursor-not-allowed"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <select
                          value={resolvedStyle}
                          onChange={(e) => pickStyle(e.target.value)}
                          disabled={isRegenerating || isChatting}
                          title="Writing style — which Style Bank style the AI mimics"
                          className="bg-neutral-900/70 border-0 rounded-full text-[11px] text-neutral-400 px-2.5 py-1 focus:outline-none max-w-[150px] cursor-pointer hover:text-neutral-300"
                        >
                          <option value="off">Style: off</option>
                          {styleGroups.map((g) => (
                            <option key={g.name} value={g.name}>
                              {g.name} ({g.count})
                            </option>
                          ))}
                        </select>

                        <select
                          value={selectedTone || ""}
                          onChange={(e) => e.target.value && handleToneChange(e.target.value)}
                          disabled={isRegenerating || isChatting}
                          title="Tone — picking one regenerates the script"
                          className="bg-neutral-900/70 border-0 rounded-full text-[11px] text-neutral-400 px-2.5 py-1 focus:outline-none cursor-pointer hover:text-neutral-300 capitalize"
                        >
                          <option value="">Tone: {analysis?.tone || "auto"}</option>
                          {["casual", "professional", "enthusiastic", "educational", "conversational", "inspirational"].map((tone) => (
                            <option key={tone} value={tone} className="capitalize">
                              {tone}
                            </option>
                          ))}
                        </select>

                        <div className="flex-1" />

                        <button
                          onClick={sendChatMessage}
                          disabled={!chatInput.trim() || isChatting}
                          title="Send — rewrites the full script; your section edits are kept"
                          className="flex items-center justify-center w-7 h-7 rounded-full bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          {isChatting ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Send size={13} />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="broll" className="mt-0 min-h-0 flex-1 overflow-y-auto">
                  <BrollPanel
                    script={generatedScript}
                    analysis={analysis}
                    model={selectedModel}
                    projectId={projectId}
                    wide={focus === "right"}
                  />
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
