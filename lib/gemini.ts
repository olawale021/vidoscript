import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  plannerSystemPrompt,
  plannerUserPrompt,
  type PlannerAnalysis,
  type PlannerOptions,
} from "@/lib/broll";
import { HUMAN_VOICE_RULES, HUMAN_VOICE_RULES_COMPACT, styleSamplesBlock } from "@/lib/voice";

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenerativeAI(apiKey);
}

function getModel(jsonMode = false) {
  const client = getGeminiClient();
  return client.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: jsonMode
      ? { responseMimeType: "application/json" }
      : undefined,
  });
}

export async function analyzeTranscript(
  transcript: string,
  wordCount?: number,
  durationSeconds?: number
): Promise<Record<string, unknown>> {
  const model = getModel(true);

  const systemPrompt = `You are a video content analyst. Analyze the given transcript and extract structural and engagement data.

Return a JSON object with ALL of these fields:

1. hookType: The technique used to grab attention (question, statistic, bold_claim, story, curiosity, controversy)
2. tone: Overall tone (casual, professional, enthusiastic, educational, conversational, inspirational)
3. pacing: How information is delivered (fast, slow, varied, building)
4. structure: Object with intro (hook description), body (array of main points as strings), cta (call to action description).
   IMPORTANT for body: Each point should cover ONE small idea or sub-topic — roughly 1-3 sentences max (~15-40 words each). If a chunk of the transcript covers multiple ideas or is longer than ~40 words, SPLIT it into separate points. Prefer MORE shorter points over FEWER long ones. A 60-second video should typically have 3-6 points.
5. themes: Array of 3-5 key themes/topics
6. sentiment: Overall emotional tone of the content ("positive", "neutral", "negative", or "mixed")
7. engagementScore: Object with four numeric scores (1-100 each):
   - overall: Overall engagement quality
   - hookEffectiveness: How well the opening grabs attention
   - retentionPotential: Likelihood of keeping viewers watching
   - ctaClarity: How clear and compelling the call to action is
8. audience: Object with:
   - primaryAudience: Who this content targets (e.g. "aspiring entrepreneurs")
   - audienceLevel: Knowledge level assumed (e.g. "beginner", "intermediate", "advanced")
   - estimatedAgeRange: Target age range (e.g. "18-35")
9. insights: Object with:
   - strengths: Array of 3-4 things the script does well
   - improvements: Array of 3-4 actionable suggestions for improvement
10. keyQuotes: Array of 2-3 standout lines/phrases from the transcript (exact quotes)
11. sentenceCount: Total number of sentences in the transcript
12. avgSentenceLength: Average number of words per sentence
13. structuredTranscript: The ORIGINAL transcript text segmented with section markers. RULES:
   - The hook is ONLY the very first sentence or short opening phrase (e.g. "to get fit with me using my fitness app"). Keep it short — just the attention-grabbing opener, NOT the explanation that follows.
   - Everything between the hook and the closing/CTA should be split into POINT sections. The number of [POINT N] sections MUST match the body array length.
   - SPLITTING RULE: Each POINT should be ~15-40 words (1-3 sentences). If a section of the transcript has multiple ideas or is longer than ~40 words, it MUST be split into separate [POINT N] sections. Never cram multiple ideas into one point. More shorter points is always better than fewer long ones.
   - The CTA is the final sentence(s) where the speaker wraps up or asks for action.
   - Use the EXACT original words — do NOT rewrite, paraphrase, or summarize.
   - CRITICAL FORMAT: Each section marker MUST be on its own line, with the content on the NEXT line. Like this:
     [HOOK]\\nfirst sentence here\\n\\n[POINT 1]\\ncontent here\\n\\n[POINT 2]\\ncontent here\\n\\n[CTA]\\nclosing here
   - Use \\n for newlines inside the JSON string value.

Return ONLY valid JSON, no markdown.`;

  const result = await model.generateContent({
    contents: [
      { role: "user", parts: [{ text: `${systemPrompt}\n\nTranscript:\n${transcript}` }] },
    ],
  });

  const content = result.response.text();
  if (!content) throw new Error("No analysis returned");

  const parsed = JSON.parse(content);

  const wc = wordCount ?? transcript.split(/\s+/).filter(Boolean).length;
  const dur = durationSeconds ?? 0;
  const wpm = dur > 0 ? Math.round(wc / (dur / 60)) : 0;

  parsed.contentMetrics = {
    wordCount: wc,
    estimatedDurationSeconds: dur,
    wordsPerMinute: wpm,
    sentenceCount: parsed.sentenceCount ?? 0,
    avgSentenceLength: parsed.avgSentenceLength ?? 0,
  };

  delete parsed.sentenceCount;
  delete parsed.avgSentenceLength;

  return parsed;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function computeSectionWordCounts(structuredTranscript: string | undefined, transcript: string, pointCount: number): { hook: number; points: number[]; cta: number; total: number } {
  const text = structuredTranscript || transcript;
  const totalWords = countWords(transcript);

  // Parse sections from structured transcript
  const hookMatch = text.match(/\[HOOK\]\s*([\s\S]*?)(?=\[POINT|\[CTA\]|\[BODY\]|$)/i);
  const ctaMatch = text.match(/\[CTA\]\s*([\s\S]*?)$/i);

  const hookWords = hookMatch ? countWords(hookMatch[1]) : Math.min(15, Math.round(totalWords * 0.1));
  const ctaWords = ctaMatch ? countWords(ctaMatch[1]) : Math.min(20, Math.round(totalWords * 0.1));

  const points: number[] = [];
  for (let i = 1; i <= pointCount; i++) {
    const re = new RegExp(`\\[POINT\\s*${i}\\]\\s*([\\s\\S]*?)(?=\\[POINT|\\[CTA\\]|$)`, "i");
    const match = text.match(re);
    if (match) {
      points.push(countWords(match[1]));
    } else {
      const remaining = totalWords - hookWords - ctaWords;
      points.push(Math.round(remaining / pointCount));
    }
  }

  return { hook: hookWords, points, cta: ctaWords, total: totalWords };
}

export async function generateScript(
  transcript: string,
  analysis: {
    hookType: string;
    tone: string;
    pacing: string;
    structure: { intro: string; body: string[]; cta: string };
    themes: string[];
    structuredTranscript?: string;
  },
  userTopic?: string,
  tone?: string,
  styleSamples?: string[],
  priorInstructions?: string[]
): Promise<string> {
  const model = getModel();
  const bodyPoints = analysis.structure.body.map((point, i) => `  ${i + 1}. ${point}`).join("\n");
  const pointCount = analysis.structure.body.length;
  const activeTone = tone || analysis.tone;

  const wc = computeSectionWordCounts(analysis.structuredTranscript, transcript, pointCount);
  const pointLimits = wc.points.map((w, i) => `- [POINT ${i + 1}]: ~${w} words`).join("\n");

  const systemPrompt = `You are a real person writing a script to talk to camera. You write the way people actually talk — not like a copywriter, not like AI, not like a blog post. Your scripts sound like someone just turned on the camera and started sharing something real.

STRICT OUTPUT FORMAT:
Your script MUST contain exactly these section headers, each on its own line — no other headers allowed:

[HOOK]
${Array.from({ length: pointCount }, (_, i) => `[POINT ${i + 1}]`).join("\n")}
[CTA]

That is ${pointCount + 2} sections total. NEVER use [BODY].

CRITICAL — WORD COUNT LIMITS (match the original video's length):
- [HOOK]: ~${wc.hook} words
${pointLimits}
- [CTA]: ~${wc.cta} words
- Total: ~${wc.total} words

Do NOT exceed these word counts. The original video was short — your script must be the same length. If the hook was 10 words, yours should be ~10 words. If a point was 25 words, yours should be ~25 words. Brevity is key.

VOICE & TONE: ${activeTone}

${HUMAN_VOICE_RULES}
${styleSamplesBlock(styleSamples ?? [])}
RULES:
1. Use the SAME hook technique (${analysis.hookType}) but with new content
2. Follow the same pacing: ${analysis.pacing}
3. Cover similar themes but from a fresh angle
4. Do NOT reuse the original's specific ideas, facts, or examples — but DO keep its everyday phrasing style and vocabulary register
5. MATCH the original's word count per section — this is the most important rule`;

  const userPrompt = `ORIGINAL TRANSCRIPT (your style sample — clone the voice, swap the content):
"""
${transcript}
"""

DETECTED STRUCTURE:
- Hook (~${wc.hook} words): ${analysis.structure.intro}
- Points:
${analysis.structure.body.map((point, i) => `  ${i + 1}. (~${wc.points[i]} words) ${point}`).join("\n")}
- CTA (~${wc.cta} words): ${analysis.structure.cta}

THEMES: ${analysis.themes.join(", ")}

${userTopic ? `NEW ANGLE/TOPIC: ${userTopic}` : "Create a fresh take on the same general topic."}
${priorInstructions && priorInstructions.length > 0 ? `
EARLIER INSTRUCTIONS & DATA FROM THE USER (from previous edits of this script — the new script MUST still honor these, including any real numbers/facts given):
${priorInstructions.map((p) => `- ${p}`).join("\n")}
` : ""}
Write the script now. Keep each section within the word counts above. Do NOT use [BODY].`;

  const result = await model.generateContent({
    contents: [
      { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
    ],
  });

  const content = result.response.text();
  if (!content) throw new Error("No script generated");

  return content;
}

function extractSectionContent(script: string, sectionType: string, sectionLabel?: string): string {
  const sectionName = sectionType === "hook" ? "HOOK"
    : sectionType === "cta" ? "CTA"
    : sectionLabel ? `POINT ${sectionLabel}` : "BODY";

  const pattern = new RegExp(`\\[${sectionName}\\]\\s*([\\s\\S]*?)(?=\\[(?:HOOK|POINT|CTA|BODY)\\]|$)`, "i");
  const match = script.match(pattern);
  return match ? match[1].trim() : "";
}

export async function regenerateSection(
  currentScript: string,
  sectionType: string,
  sectionLabel: string,
  analysis: {
    hookType: string;
    tone: string;
    pacing: string;
    structure: { intro: string; body: string[]; cta: string };
    themes: string[];
  },
  tone?: string,
  userContext?: string
): Promise<string> {
  const model = getModel();
  const sectionName = sectionType === "hook" ? "HOOK"
    : sectionType === "cta" ? "CTA"
    : sectionLabel ? `POINT ${sectionLabel}` : "BODY";

  const activeTone = tone || analysis.tone;
  const currentContent = extractSectionContent(currentScript, sectionType, sectionLabel);
  const targetWordCount = countWords(currentContent);

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{
          text: `You are a real person rewriting one section of a video script.

${HUMAN_VOICE_RULES_COMPACT}

You will be given a full video script and asked to rewrite ONLY the "${sectionName}" section. Keep the ${activeTone} tone, ${analysis.pacing} pacing, and themes, but produce a fresh human-sounding take for that one section.

${userContext ? `IMPORTANT USER CONTEXT (keep this in mind while rewriting): ${userContext}` : ""}

STRICT WORD COUNT: The current section is ${targetWordCount} words. Your rewrite MUST be approximately ${targetWordCount} words (within ±5 words). Do NOT expand or pad the section. Match the original length precisely.

Return ONLY the new text content for that section — no headers, no labels, no brackets, no markdown. Just the script lines.

FULL CURRENT SCRIPT:
"""
${currentScript}
"""

Rewrite ONLY the "${sectionName}" section in ~${targetWordCount} words. Make it sound like a real person talking. Return just the new content for that section, nothing else.`
        }],
      },
    ],
  });

  const content = result.response.text();
  if (!content) throw new Error("No content generated");

  return content.trim();
}

export async function regenerateSectionVariations(
  currentScript: string,
  sectionType: string,
  sectionLabel: string,
  analysis: {
    hookType: string;
    tone: string;
    pacing: string;
    structure: { intro: string; body: string[]; cta: string };
    themes: string[];
  },
  tone?: string,
  count: number = 5,
  userContext?: string
): Promise<string[]> {
  const model = getModel(true);
  const sectionName = sectionType === "hook" ? "HOOK"
    : sectionType === "cta" ? "CTA"
    : sectionLabel ? `POINT ${sectionLabel}` : "BODY";

  const activeTone = tone || analysis.tone;

  const currentContent = extractSectionContent(currentScript, sectionType, sectionLabel);
  const targetWordCount = countWords(currentContent);

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{
          text: `You are a real person writing variations of one section of a video script.

${HUMAN_VOICE_RULES_COMPACT}

${userContext ? `IMPORTANT USER CONTEXT (keep this in mind for all variations): ${userContext}` : ""}

You will be given a full video script and must generate exactly ${count} DIFFERENT variations of ONLY the "${sectionName}" section. Each variation should have a distinctly different approach or angle while keeping the ${activeTone} tone and ${analysis.pacing} pacing.

STRICT WORD COUNT: The current section is ${targetWordCount} words. Each variation MUST be approximately ${targetWordCount} words (within ±5 words). Do NOT expand, elaborate, or pad the content. Match the original length precisely — short sections stay short.

Return a JSON object with a "variations" key containing an array of ${count} strings. Each string is one complete variation of the section. No headers, labels, or markdown inside the strings.

FULL CURRENT SCRIPT:
"""
${currentScript}
"""

Generate ${count} different variations of the "${sectionName}" section. Each must be ~${targetWordCount} words and sound like a real person talking, with a unique angle or phrasing.`
        }],
      },
    ],
  });

  const content = result.response.text();
  if (!content) throw new Error("No variations generated");

  const parsed = JSON.parse(content);
  const variations = parsed.variations || parsed.options || parsed.results || (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);

  if (!Array.isArray(variations)) throw new Error("Invalid variations format");

  return variations.map((v: string) => v.trim()).slice(0, count);
}

export async function chatRefineScript(
  currentScript: string,
  userInstruction: string,
  analysis: {
    hookType: string;
    tone: string;
    pacing: string;
    structure: { intro: string; body: string[]; cta: string };
    themes: string[];
  },
  tone?: string,
  userContext?: string,
  history?: { role: "user" | "assistant"; content: string }[],
  styleSamples?: string[]
): Promise<string> {
  const model = getModel();
  const activeTone = tone || analysis.tone;
  const targetWordCount = countWords(currentScript.replace(/\[[^\]]+\]/g, " "));

  const conversation = (history && history.length > 0)
    ? `CONVERSATION SO FAR (earlier edit requests for this script):\n${history
        .filter((m) => m.role === "user")
        .map((m) => `- ${m.content}`)
        .join("\n")}\n\n`
    : "";

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{
          text: `You are editing a full video script based on the user's chat instructions.

${HUMAN_VOICE_RULES_COMPACT}
${styleSamplesBlock(styleSamples ?? [])}
${userContext ? `OVERALL DIRECTION FOR THIS SCRIPT: ${userContext}\n` : ""}
${conversation}Apply the user's latest request to the WHOLE script and return the complete, updated script.

STRICT OUTPUT FORMAT:
- Keep the section marker format: [HOOK] on its own line, then each point as [POINT 1], [POINT 2], etc., then [CTA] — each header on its own line with the content on the next line.
- NEVER use [BODY].
- Only change the number of [POINT N] sections if the user explicitly asks to add or remove points. Otherwise keep the same sections.
- Renumber points sequentially if you add or remove any.

RULES:
1. Apply the user's request faithfully — this is the most important thing.
2. Keep the ${activeTone} tone and ${analysis.pacing} pacing unless the user asks to change it.
3. Preserve roughly the same overall length (~${targetWordCount} words) unless the request implies otherwise (e.g. "add 2 more points" makes it longer, "make it shorter" makes it shorter).
4. Only rewrite what the request touches — leave the rest of the script intact so the user's earlier edits are preserved.
5. Make it sound like a real person talking to camera, not a copywriter.

Return ONLY the full updated script with its section markers. No preamble, no explanation, no markdown fences.

CURRENT SCRIPT:
"""
${currentScript}
"""

USER'S REQUEST: ${userInstruction}

Return the full updated script now.`
        }],
      },
    ],
  });

  const content = result.response.text();
  if (!content) throw new Error("No script generated");

  return content.trim();
}

export async function chatRewriteSection(
  currentScript: string,
  sectionType: string,
  sectionLabel: string,
  sectionContent: string,
  userInstruction: string,
  tone?: string,
  count: number = 5,
  userContext?: string
): Promise<string[]> {
  const model = getModel(true);
  const sectionName = sectionType === "hook" ? "HOOK"
    : sectionType === "cta" ? "CTA"
    : sectionLabel ? `POINT ${sectionLabel}` : "BODY";

  const targetWordCount = countWords(sectionContent);

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [{
          text: `You are rewriting one section of a video script based on the user's instructions.

${HUMAN_VOICE_RULES_COMPACT}

${userContext ? `IMPORTANT USER CONTEXT (the overall direction for this script): ${userContext}` : ""}

FULL SCRIPT FOR CONTEXT:
"""
${currentScript}
"""

CURRENT "${sectionName}" SECTION (${targetWordCount} words):
"""
${sectionContent}
"""

USER'S REQUEST: ${userInstruction}

${tone ? `TONE: ${tone}` : ""}

STRICT WORD COUNT: The current section is ${targetWordCount} words. Each variation MUST be approximately ${targetWordCount} words (within ±5 words). Do NOT expand, elaborate, or add extra detail beyond what's in the original. Apply the user's request while keeping the same length. If the original is 2 sentences, yours should be ~2 sentences. Short stays short.

Generate exactly ${count} DIFFERENT variations of the "${sectionName}" section based on the user's request. Each variation should interpret the request differently while staying true to the intent.

Return a JSON object with a "variations" key containing an array of ${count} strings. No headers, labels, or markdown inside the strings.`
        }],
      },
    ],
  });

  const content = result.response.text();
  if (!content) throw new Error("No content generated");

  const parsed = JSON.parse(content);
  const variations = parsed.variations || parsed.options || parsed.results || (Array.isArray(parsed) ? parsed : Object.values(parsed)[0]);

  if (!Array.isArray(variations)) throw new Error("Invalid variations format");

  return variations.map((v: string) => v.trim()).slice(0, count);
}

// Write a script from a topic or rough notes — no source video. The Style Bank
// samples carry the voice; the notes carry the content.
export async function generateScriptFromIdea(
  idea: string,
  options: {
    tone?: string;
    styleSamples?: string[];
    priorInstructions?: string[];
    extraDirection?: string;
  } = {}
): Promise<string> {
  const model = getModel();
  const { tone, styleSamples, priorInstructions, extraDirection } = options;

  const prompt = `You are a real person writing a script to talk to camera for a short-form video (Reel/Short/TikTok).

STRICT OUTPUT FORMAT:
[HOOK]
then [POINT 1] ... [POINT N] (pick 3-6 points, whatever the content deserves)
then [CTA]
Each header on its own line, content on the next. NEVER use [BODY].

LENGTH: a short-form video — roughly 120-220 words total. Hook is 1-2 short sentences. Points are 1-3 sentences each. CTA is one line.

${tone ? `VOICE & TONE: ${tone}\n` : ""}
${HUMAN_VOICE_RULES}
${styleSamplesBlock(styleSamples ?? [])}
CONTENT RULES:
1. The user's notes below are the CONTENT SOURCE. Build the script from them — keep their facts, angle, and any numbers exactly.
2. NEVER invent statistics or facts. If the notes have no numbers, write without numbers.
3. If the notes are just a topic, develop it with genuinely useful substance, not filler.
${extraDirection ? `4. EXTRA DIRECTION: ${extraDirection}` : ""}
${priorInstructions && priorInstructions.length > 0 ? `
EARLIER INSTRUCTIONS & DATA FROM THE USER (must still be honored):
${priorInstructions.map((p) => `- ${p}`).join("\n")}
` : ""}
THE USER'S TOPIC / ROUGH NOTES:
"""
${idea}
"""

Write the script now.`;

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const content = result.response.text();
  if (!content) throw new Error("No script generated");
  return content;
}

// Plan a b-roll ScenePlan from a script. Returns raw parsed JSON; the caller
// validates it with validateScenePlan() (see lib/broll.ts).
export async function planScenes(
  script: string,
  analysis: PlannerAnalysis,
  options: PlannerOptions = {},
  repairHint?: string
): Promise<unknown> {
  const model = getModel(true); // JSON mode
  const system = plannerSystemPrompt();
  const user = plannerUserPrompt(script, analysis, options, repairHint);

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
  });

  const content = result.response.text();
  if (!content) throw new Error("No scene plan generated");

  return JSON.parse(content);
}
