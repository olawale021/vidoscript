// Shared "sound human" writing rules for script generation. Both providers
// (lib/gemini.ts / lib/openai.ts) import from here so the voice spec lives in
// exactly one place.
//
// Design notes, from real failure analysis:
// - AI misses "human" in two directions: robot-formal (thesaurus words —
//   "foresee", "let's check that out now") and robot-casual (performed
//   quirkiness — "...it got weird"). Both are the model performing a register
//   instead of just saying the thing.
// - The old "DO NOT copy any phrases" rule *caused* the thesaurus drift: banned
//   from the natural phrasing it just saw, the model only knows how to go up
//   the formality ladder. Fix: novelty goes into CONTENT, never vocabulary.
// - The old "start sentences with So/Look/Here's the thing" + "add ... pauses"
//   instructions manufactured fake-casualness. Removed: real speech is plain.
// - The original transcript is a real person talking — it IS the style sample.

export const HUMAN_VOICE_RULES = `HOW TO SOUND HUMAN — CLONE THE VOICE, SWAP THE CONTENT:
The original transcript is a real person talking. It is your style sample. Mirror its sentence shapes, rhythm, and vocabulary register as closely as you can — change only the subject matter.

- Stock spoken phrases ("well, let's find out", "so basically", "turns out") are NOT copying — reuse them freely. What you must never reuse is the original's specific ideas, facts, and examples.
- Never swap a common word for a fancier synonym: "guess" beats "foresee", "use" beats "utilize", "find out" beats "discover". Always pick the word people say out loud.
- BANNED words and phrases (instant AI tells): leverage, utilize, optimize, game-changer, dive into, delve, unlock, journey, elevate, foresee, uncover, unveil, envision, harness, moreover, furthermore, "check that out", "in this video".
- Do not PERFORM casualness either: no decorative "Honestly," / "Look," / "Here's the thing" openers, no "..." dramatic pauses, no engineered punchlines. Real speech is plain — the idea carries the interest; the sentences are ordinary.
- Use contractions (don't, isn't, you're). Talk TO the viewer ("you"). Vary sentence length the way the original does.

THE TEST: every line must read like a transcription of someone talking, not a script someone wrote. If a line looks like it's trying to be clever or hook-y, flatten it.

EXAMPLES — same idea, three ways:
- Robot-formal (NEVER): "Can machine learning foresee World Cup winners? Let's check that out now."
- Robot-casual (NEVER): "I asked a computer to pick the World Cup winner... it got weird."
- Human (YES): "Can we use machine learning to predict this year's World Cup winner? Well, let's find out."`;

// Style Bank: real transcripts injected as writing-style exemplars. These
// outrank everything except the output format — they're actual samples of the
// target writing style, which teaches voice better than any instruction.
export function styleSamplesBlock(samples: string[]): string {
  const usable = samples.filter((s) => s && s.trim()).slice(0, 6);
  if (usable.length === 0) return "";
  return `
REAL STYLE SAMPLES — these are transcripts of real videos in the target writing style. Study how they open, their sentence shapes, their vocabulary, their rhythm. Your script must read like it was spoken by the same person (topic aside):

${usable.map((s, i) => `--- SAMPLE ${i + 1} ---\n${s.trim().slice(0, 2500)}`).join("\n\n")}
--- END SAMPLES ---
`;
}

export const HUMAN_VOICE_RULES_COMPACT = `WRITING VOICE:
- Match the register and rhythm of the surrounding script exactly — same plain spoken vocabulary, same sentence shapes.
- Never swap common words for fancier synonyms: "guess" beats "foresee", "use" beats "utilize", "find out" beats "discover". Banned AI tells: leverage, utilize, optimize, game-changer, dive into, delve, unlock, journey, elevate, foresee, uncover, unveil, envision, harness, moreover, furthermore.
- Don't perform casualness: no decorative "Honestly," / "Look," openers, no "..." dramatic pauses, no engineered punchlines. Plain beats clever — the idea carries the interest.
- Every line must read like a transcription of someone talking, not writing.`;
