// USD prices used by the admin AI-cost dashboard. Edit when providers change
// pricing; costs are computed when each call is recorded, so old rows keep
// the price that applied at the time.
//
// Token prices are per 1M tokens. Whisper is per audio minute.
// Last checked from memory (Nov 2026) — verify on the providers' pricing pages.

export const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

export const WHISPER_PRICE_PER_MINUTE = 0.006;
// Groq whisper-large-v3-turbo: $0.04 per hour, 10 s minimum per request.
export const GROQ_WHISPER_PRICE_PER_HOUR = 0.04;

export function tokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(TOKEN_PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  if (!key) return 0;
  const p = TOKEN_PRICES[key];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function whisperCost(audioSeconds: number): number {
  return (audioSeconds / 60) * WHISPER_PRICE_PER_MINUTE;
}

export function groqWhisperCost(audioSeconds: number): number {
  return (Math.max(10, audioSeconds) / 3600) * GROQ_WHISPER_PRICE_PER_HOUR;
}
