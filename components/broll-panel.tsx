"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Player } from "@remotion/player";
import { useQuery, useMutation } from "convex/react";
import {
  Clapperboard,
  Loader2,
  RefreshCw,
  Trash2,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Film,
  Download,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScenePlan, Scene, Aspect } from "@/types/broll";
import { BrollComposition, FPS, aspectDims, planDurationInFrames } from "@/remotion/Broll";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import { THEME_NAMES, THEME_LABELS } from "@/remotion/theme";

const ASPECTS: Aspect[] = ["9:16", "16:9", "1:1"];

// Pull the script text of the beat a scene visualizes ("HOOK", "POINT 2", "CTA").
function extractBeatText(script: string, sourceBeat: string): string | null {
  const name = sourceBeat.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = script.match(
    new RegExp(`\\[${name}\\]\\s*([\\s\\S]*?)(?=\\[(?:HOOK|POINT|CTA|BODY)|$)`, "i")
  );
  const text = m ? m[1].trim() : null;
  return text || null;
}

interface BrollPanelProps {
  script: string;
  analysis: unknown;
  model: "gemini" | "gpt4o";
  projectId: Id<"projects"> | null;
  wide?: boolean;
}

export function BrollPanel({ script, analysis, model, projectId, wide }: BrollPanelProps) {
  const [plan, setPlan] = useState<ScenePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [theme, setTheme] = useState("auto");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  // Which AI plans the b-roll — starts from the workspace's model, independently changeable
  const [plannerModel, setPlannerModel] = useState<"gemini" | "gpt4o">(model);

  // Changing the design pack re-skins an existing plan instantly (no re-plan).
  const changeTheme = (v: string) => {
    setTheme(v);
    if (v !== "auto") setPlan((p) => (p ? { ...p, theme: v } : p));
  };

  // Convex persistence + render status
  const saveScenePlan = useMutation(api.broll.saveScenePlan);
  const enqueueRender = useMutation(api.broll.enqueueRender);
  const render = useQuery(
    api.broll.getByProject,
    projectId ? { projectId } : "skip"
  );
  const hydratedFor = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate the saved plan once per project (so it survives refresh)
  useEffect(() => {
    if (!projectId || plan || !render?.scenePlan) return;
    if (hydratedFor.current === projectId) return;
    hydratedFor.current = projectId;
    setPlan(render.scenePlan as ScenePlan);
  }, [projectId, render, plan]);

  // Debounced save of the plan to Convex
  useEffect(() => {
    if (!projectId || !plan) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveScenePlan({ projectId, scenePlan: plan }).catch((e) =>
        console.error("Save plan failed:", e)
      );
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, projectId]);

  // Resolve real Pexels footage for every footage scene that has a query.
  const resolveAssetsForPlan = useCallback(async (pl: ScenePlan): Promise<ScenePlan> => {
    const idxs = pl.scenes
      .map((s, i) => (s.kind === "footage" && s.query ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length === 0) return pl;
    try {
      const res = await fetch("/api/broll/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: idxs.map((i) => pl.scenes[i].query), aspect: pl.aspect, type: "video" }),
      });
      const data = await res.json();
      if (data.error) setWarnings((w) => [...w, `Footage: ${data.error}`]);
      const assets = data.assets || [];
      const scenes = [...pl.scenes];
      idxs.forEach((sceneIdx, k) => {
        const a = assets[k];
        if (a) scenes[sceneIdx] = { ...scenes[sceneIdx], assetRef: a.url, assetType: a.type, assetCredit: a.credit };
      });
      return { ...pl, scenes };
    } catch {
      return pl;
    }
  }, []);

  const generate = useCallback(async () => {
    if (!script.trim()) return;
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      const res = await fetch("/api/broll/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          analysis,
          theme: theme === "auto" ? undefined : theme,
          aspect,
          model: plannerModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Planning failed");
      setPlan(data.plan);
      setWarnings(data.warnings || []);
      const withAssets = await resolveAssetsForPlan(data.plan);
      setPlan(withAssets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [script, analysis, theme, aspect, plannerModel, resolveAssetsForPlan]);

  const findFootage = async (i: number) => {
    if (!plan) return;
    const scene = plan.scenes[i];
    if (!scene.query) return;
    try {
      const res = await fetch("/api/broll/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: [scene.query], aspect: plan.aspect, type: "video" }),
      });
      const data = await res.json();
      const a = (data.assets || [])[0];
      if (a) updateScene(i, { assetRef: a.url, assetType: a.type, assetCredit: a.credit });
      else if (data.error) setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Footage search failed");
    }
  };

  const updateScene = (i: number, patch: Partial<Scene>) =>
    setPlan((p) => (p ? { ...p, scenes: p.scenes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) } : p));
  const moveScene = (i: number, dir: -1 | 1) =>
    setPlan((p) => {
      if (!p) return p;
      const j = i + dir;
      if (j < 0 || j >= p.scenes.length) return p;
      const scenes = [...p.scenes];
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
      return { ...p, scenes };
    });
  const deleteScene = (i: number) =>
    setPlan((p) => (p ? { ...p, scenes: p.scenes.filter((_, idx) => idx !== i) } : p));

  const exportMp4 = async () => {
    if (!projectId || !plan) return;
    try {
      await saveScenePlan({ projectId, scenePlan: plan });
      await enqueueRender({ projectId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start render");
    }
  };

  const dims = plan ? aspectDims(plan.aspect) : aspectDims(aspect);
  const status = render?.status;
  const rendering = status === "queued" || status === "rendering";

  return (
    <div className="p-4 space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={generate} disabled={loading || !script.trim()}>
          {loading ? <Loader2 className="mr-1.5 animate-spin" size={14} /> : <Clapperboard className="mr-1.5" size={14} />}
          {loading ? "Planning..." : plan ? "Regenerate" : "Generate B-roll"}
        </Button>

        <div className="flex items-center bg-neutral-800 rounded-full p-0.5">
          {ASPECTS.map((a) => (
            <button key={a} onClick={() => setAspect(a)} disabled={loading}
              className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition",
                aspect === a ? "bg-neutral-600 text-white" : "text-neutral-500 hover:text-neutral-300")}>
              {a}
            </button>
          ))}
        </div>

        {/* Planner model */}
        <div className="flex items-center bg-neutral-800 rounded-full p-0.5">
          {([
            { key: "gemini" as const, label: "Gemini" },
            { key: "gpt4o" as const, label: "GPT-4o" },
          ]).map(({ key, label }) => (
            <button key={key} onClick={() => setPlannerModel(key)} disabled={loading}
              title="Which AI plans the b-roll scenes"
              className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition",
                plannerModel === key ? "bg-neutral-600 text-white" : "text-neutral-500 hover:text-neutral-300")}>
              {label}
            </button>
          ))}
        </div>

        <select value={theme} onChange={(e) => changeTheme(e.target.value)} disabled={loading}
          title="Design pack — auto lets the AI pick by content type; changing it re-skins the plan instantly"
          className="bg-neutral-800 border border-neutral-700 rounded-md text-xs text-neutral-300 px-2 py-1.5 focus:outline-none max-w-[210px]">
          <option value="auto">Design: auto</option>
          {THEME_NAMES.map((t) => <option key={t} value={t}>{THEME_LABELS[t] || t}</option>)}
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-red-900/50 bg-red-950/30 rounded-md p-3 text-sm text-red-300">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {!plan && !loading && !error && (
        <p className="text-sm text-neutral-500">
          Turn your script into a b-roll storyboard — motion-graphic scenes + stock footage,
          previewed live below. Then tweak captions, durations, and order, and export an MP4.
        </p>
      )}

      {plan && (
        <>
          {/* Live preview — capped so a portrait comp doesn't blow up on wide panels */}
          <div
            className="rounded-lg overflow-hidden border border-neutral-800 bg-black mx-auto w-full"
            style={{ maxWidth: Math.round(560 * (dims.width / dims.height)) }}
          >
            <Player
              component={BrollComposition}
              inputProps={{ plan }}
              durationInFrames={planDurationInFrames(plan)}
              fps={FPS}
              compositionWidth={dims.width}
              compositionHeight={dims.height}
              style={{ width: "100%" }}
              controls
              loop
            />
          </div>

          {/* Export / render status */}
          <div className="flex items-center gap-2 flex-wrap">
            {status === "done" && render?.outputUrl ? (
              <a href={render.outputUrl} download={`broll-${projectId}.mp4`}>
                <Button size="sm">
                  <Download className="mr-1.5" size={14} /> Download MP4
                </Button>
              </a>
            ) : (
              <Button size="sm" onClick={exportMp4} disabled={!projectId || rendering}>
                {rendering ? <Loader2 className="mr-1.5 animate-spin" size={14} /> : <Film className="mr-1.5" size={14} />}
                {rendering ? `Rendering ${render?.progress ?? 0}%` : "Export MP4"}
              </Button>
            )}
            {status === "done" && (
              <Button size="sm" variant="outline" onClick={exportMp4} disabled={rendering}>
                <RefreshCw className="mr-1.5" size={13} /> Re-render
              </Button>
            )}
            {status === "failed" && (
              <span className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle size={12} /> {render?.error || "Render failed"}
              </span>
            )}
            <span className="text-xs text-neutral-500 ml-auto">
              {plan.scenes.length} scenes · ~{plan.scenes.reduce((a, s) => a + s.durationSec, 0)}s · {plan.aspect}
            </span>
          </div>

          {rendering && (
            <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div className="h-full bg-white transition-all" style={{ width: `${render?.progress ?? 0}%` }} />
            </div>
          )}

          {warnings.length > 0 && (
            <details className="text-xs text-amber-400/80">
              <summary className="cursor-pointer">{warnings.length} planner note(s)</summary>
              <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}

          {/* Scene list */}
          <div className={cn(wide ? "grid grid-cols-2 2xl:grid-cols-3 gap-2 items-start" : "space-y-2")}>
            {plan.scenes.map((scene, i) => {
              const sceneFrames = Math.max(1, Math.round(scene.durationSec * FPS));
              const beatText = scene.sourceBeat ? extractBeatText(script, scene.sourceBeat) : null;
              return (
              <div key={scene.id} className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
                {/* Per-scene "screen" — playable on its own */}
                <div className="flex justify-center bg-black rounded-md overflow-hidden mb-2" style={{ height: 190 }}>
                  <Player
                    component={BrollComposition}
                    inputProps={{ plan: { ...plan, scenes: [scene] } }}
                    durationInFrames={sceneFrames}
                    fps={FPS}
                    compositionWidth={dims.width}
                    compositionHeight={dims.height}
                    style={{ height: "100%" }}
                    controls
                    loop
                  />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded",
                    scene.kind === "footage" ? "bg-cyan-900/40 text-cyan-300" : "bg-emerald-900/40 text-emerald-300")}>
                    {scene.template}
                  </span>
                  {scene.sourceBeat && <span className="text-xs text-neutral-500">{scene.sourceBeat}</span>}
                  {scene.needsInput && (
                    <span className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={11} /> needs input</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => moveScene(i, -1)} disabled={i === 0} className="text-neutral-500 hover:text-white disabled:opacity-30"><ChevronUp size={14} /></button>
                    <button onClick={() => moveScene(i, 1)} disabled={i === plan.scenes.length - 1} className="text-neutral-500 hover:text-white disabled:opacity-30"><ChevronDown size={14} /></button>
                    <button onClick={() => deleteScene(i)} className="text-neutral-500 hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* The script text this scene visualizes */}
                {beatText && (
                  <p className="text-xs text-neutral-400 leading-relaxed border-l-2 border-neutral-700 pl-2 mb-2 line-clamp-3" title={beatText}>
                    {beatText}
                  </p>
                )}

                <input type="text" value={scene.caption || ""} onChange={(e) => updateScene(i, { caption: e.target.value })}
                  placeholder="Caption (optional)"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600 mb-2" />

                {scene.kind === "footage" && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5">
                      <input type="text" value={scene.query || ""} onChange={(e) => updateScene(i, { query: e.target.value })}
                        placeholder="Stock search query"
                        className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-cyan-200 placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600" />
                      <button onClick={() => findFootage(i)} disabled={!scene.query}
                        title="Find stock footage on Pexels"
                        className="flex items-center gap-1 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:text-white disabled:opacity-40">
                        <Search size={12} /> Find
                      </button>
                    </div>
                    <div className="text-xs mt-1">
                      {scene.assetRef ? (
                        <span className="text-cyan-400/80">
                          ✓ {scene.assetType} · {scene.assetCredit ? `by ${scene.assetCredit}` : "Pexels"}
                        </span>
                      ) : (
                        <span className="text-neutral-600">no footage yet — click Find (needs PEXELS_API_KEY)</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-xs text-neutral-600 font-mono truncate max-w-[65%]">{JSON.stringify(scene.props)}</div>
                  <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                    dur
                    <input type="number" min={1} max={15} value={scene.durationSec}
                      onChange={(e) => updateScene(i, { durationSec: Math.max(1, Math.min(15, Number(e.target.value) || 1)) })}
                      className="w-14 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-neutral-300 focus:outline-none" />
                    s
                  </label>
                </div>
              </div>
              );
            })}
          </div>

          <p className="text-xs text-neutral-600 flex items-center gap-1.5">
            <RefreshCw size={11} /> Edits save automatically & update the preview. Export runs the render worker.
          </p>
        </>
      )}
    </div>
  );
}
