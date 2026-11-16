// USD prices used by the admin AI-cost dashboard. Edit when providers change
// pricing; costs are computed when each call is recorded, so old rows keep
// the price that applied at the time.
//
// Token prices are per 1M tokens. Whisper is per audio minute.
// Last checked from memory (Nov 2026) — verify on the providers' pricing pages.

export const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

export const WHISPER_PRICE_PER_MINUTE = 0.006;

export function tokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(TOKEN_PRICES).find((k) => model === k || model.startsWith(`${k}-`));
  if (!key) return 0;
  const p = TOKEN_PRICES[key];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function whisperCost(audioSeconds: number): number {
  return (audioSeconds / 60) * WHISPER_PRICE_PER_MINUTE;
}
