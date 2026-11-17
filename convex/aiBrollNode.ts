"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { r2, storagePrefix } from "./r2";
import { AI_VIDEO_MODELS, type AiVideoModel } from "../types/clip";

// AI B-roll shots via Higgsfield (https://docs.higgsfield.ai). Paid per
// generation, so only ever runs when the user clicks "Generate" in the editor.
// Env: HIGGSFIELD_KEY_ID, HIGGSFIELD_KEY_SECRET.

const BASE = "https://api.higgsfield.ai";
const modelV = v.union(v.literal("kling-3-std"), v.literal("wan-2.7"), v.literal("seedance-2.0"));

// Accepts either one combined key (HIGGSFIELD_API_KEY, usually "id:secret")
// or the separate HIGGSFIELD_KEY_ID + HIGGSFIELD_KEY_SECRET pair.
function authHeader() {
  const single = process.env.HIGGSFIELD_API_KEY?.trim();
  const id = process.env.HIGGSFIELD_KEY_ID?.trim();
  const secret = process.env.HIGGSFIELD_KEY_SECRET?.trim();
  const key = single || (id && secret ? `${id}:${secret}` : "");
  if (!key) throw new Error("Higgsfield API key is not set (HIGGSFIELD_API_KEY)");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

function requestBody(model: AiVideoModel, prompt: string, seconds: number, aspect: string) {
  const m = AI_VIDEO_MODELS[model];
  const duration = Math.max(m.minSec, Math.min(m.maxSec, Math.ceil(seconds)));
  const base = { prompt: prompt.slice(0, 2000), duration, aspect_ratio: aspect };
  if (model === "kling-3-std") return { ...base, sound: "off" };
  if (model === "wan-2.7") return { ...base, resolution: "720p" };
  return { ...base, resolution: "720p", generate_audio: false };
}

const fullPrompt = (prompt: string) =>
  `${prompt.trim()}. Cinematic B-roll, no text, no captions, no logos, no people talking to camera.`;

// Higgsfield /estimate returns either {"usd": "0.094"} or a text rate card:
// {"pricing_description": "... per video second: 720p: $0.0714; 1080p: ..."}.
async function estimatePrice(model: AiVideoModel, body: Record<string, unknown>): Promise<number | null> {
  const res = await fetch(`${BASE}/estimate/${AI_VIDEO_MODELS[model].endpoint}`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { usd?: string | number; pricing_description?: string };
  const usd = Number(data.usd);
  if (Number.isFinite(usd) && usd > 0) return usd;
  const text = data.pricing_description ?? "";
  const resolution = typeof body.resolution === "string" ? body.resolution : "720p";
  const rate =
    text.match(new RegExp(`${resolution}:\\s*\\$(\\d+(?:\\.\\d+)?)`, "i"))?.[1] ?? text.match(/\$(\d+(?:\.\d+)?)/)?.[1];
  const seconds = Number(body.duration) || 0;
  const perSecond = /per video second/i.test(text);
  if (!rate) return null;
  const price = perSecond ? Number(rate) * seconds : Number(rate);
  return Number.isFinite(price) ? Math.round(price * 10000) / 10000 : null;
}

async function userId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity.subject;
}

// Price in USD for a shot before generating (Higgsfield /estimate).
export const estimate = action({
  args: { clipId: v.id("clips"), brollId: v.string(), prompt: v.string(), model: modelV },
  handler: async (ctx, { clipId, brollId, prompt, model }): Promise<number | null> => {
    const uid = await userId(ctx);
    const clip = await ctx.runQuery(internal.aiBroll.clipForUser, { clipId, userId: uid });
    if (!clip?.smart) throw new Error("Not found");
    const item = (clip.smart as { broll: { id: string; dur: number }[] }).broll.find((b) => b.id === brollId);
    if (!item) throw new Error("B-roll item not found");
    return await estimatePrice(model, requestBody(model, fullPrompt(prompt), item.dur, clip.aspect));
  },
});

export const generate = action({
  args: { clipId: v.id("clips"), brollId: v.string(), prompt: v.string(), model: modelV },
  handler: async (ctx, { clipId, brollId, prompt, model }): Promise<{ requestId: string; costUsd: number | null }> => {
    const uid = await userId(ctx);
    if (!prompt.trim()) throw new Error("Describe the shot first");
    const clip = await ctx.runQuery(internal.aiBroll.clipForUser, { clipId, userId: uid });
    if (!clip?.smart) throw new Error("Not found");
    const item = (clip.smart as { broll: { id: string; dur: number; ai?: { status?: string } }[] }).broll.find(
      (b) => b.id === brollId
    );
    if (!item) throw new Error("B-roll item not found");
    if (item.ai?.status === "generating") throw new Error("Already generating");

    const body = requestBody(model, fullPrompt(prompt), item.dur, clip.aspect);
    // Price is recorded on completion (failed / NSFW generations are free).
    let costUsd: number | null = null;
    try {
      costUsd = await estimatePrice(model, body);
    } catch {
      // estimate is best-effort
    }

    const res = await fetch(`${BASE}/${AI_VIDEO_MODELS[model].endpoint}`, {
      method: "POST",
      headers: { ...authHeader(), "Idempotency-Key": crypto.randomUUID(), "Hf-Expires-After": "86400" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const message = `Higgsfield rejected the request (${res.status}): ${text.slice(0, 200)}`;
      await ctx.runMutation(internal.errors.log, { feature: "clips.aiBroll", message, userId: uid, clipId });
      throw new Error(message);
    }
    const sub = (await res.json()) as { request_id: string; status_url: string };

    await ctx.runMutation(internal.aiBroll.patchBroll, {
      clipId,
      brollId,
      patch: {
        kind: "ai",
        enabled: false, // turned on automatically when the video is ready
        ai: { model, prompt: prompt.trim(), status: "generating", requestId: sub.request_id, error: null, costUsd },
      },
    });
    await ctx.scheduler.runAfter(5000, internal.aiBrollNode.poll, {
      clipId,
      brollId,
      statusUrl: sub.status_url,
      userId: uid,
      model,
      costUsd: costUsd ?? 0,
      attempt: 0,
    });
    return { requestId: sub.request_id, costUsd };
  },
});

// Polls the Higgsfield request; on completion copies the video into R2.
export const poll = internalAction({
  args: {
    clipId: v.id("clips"),
    brollId: v.string(),
    statusUrl: v.string(),
    userId: v.string(),
    model: modelV,
    costUsd: v.number(),
    attempt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const fail = async (error: string): Promise<void> => {
      await ctx.runMutation(internal.errors.log, {
        feature: "clips.aiBroll",
        message: error,
        userId: args.userId,
        clipId: args.clipId,
      });
      await ctx.runMutation(internal.aiBroll.patchBroll, {
        clipId: args.clipId,
        brollId: args.brollId,
        patch: { ai: { status: "failed", error } },
      });
    };

    let data: { status?: string; error?: string | null; video?: { url?: string } } = {};
    try {
      const res = await fetch(args.statusUrl, { headers: authHeader() });
      data = res.ok ? await res.json() : {};
    } catch {
      // transient — retry below
    }

    if (data.status === "completed" && data.video?.url) {
      const video = await fetch(data.video.url);
      if (!video.ok) return await fail(`Could not download the generated video (${video.status})`);
      const key = await r2.store(ctx, new Uint8Array(await video.arrayBuffer()), {
        key: `${storagePrefix()}/ai-broll/${args.userId}/${args.clipId}-${args.brollId}-${Date.now()}.mp4`,
        type: "video/mp4",
      });
      await ctx.runMutation(internal.aiBroll.patchBroll, {
        clipId: args.clipId,
        brollId: args.brollId,
        patch: { assetKey: key, assetType: "video", enabled: true, ai: { status: "ready", error: null } },
      });
      await ctx.runMutation(internal.usage.recordInternal, {
        userId: args.userId,
        provider: "higgsfield",
        model: args.model,
        feature: "clips.aiBroll",
        inputTokens: 0,
        outputTokens: 1,
        costUsd: args.costUsd,
      });
      return;
    }
    if (data.status === "nsfw") return await fail("Blocked by the content filter — try a different description");
    if (data.status === "failed" || data.status === "canceled") return await fail(data.error || "Generation failed");

    // queued / in_progress / transient error: back off 5 s → 15 s, give up after ~15 min.
    if (args.attempt >= 80) return await fail("Timed out waiting for Higgsfield");
    await ctx.scheduler.runAfter(Math.min(15000, 5000 + args.attempt * 1000), internal.aiBrollNode.poll, {
      ...args,
      attempt: args.attempt + 1,
    });
  },
});
