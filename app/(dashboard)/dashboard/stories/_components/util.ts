import { STORY_STYLES, STORY_VOICES } from "@/types/story";

// Convex errors arrive as "[CONVEX M(...)] Uncaught Error: <message>\n at ...".
export const errText = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : String(e);

export const fmtLength = (sec: number) => (sec < 60 ? `${sec}s` : `${sec / 60} min`);

export const styleLabel = (id: string) => STORY_STYLES[id]?.label ?? id;

export const voiceName = (id: string) => STORY_VOICES.find((v) => v.id === id)?.label.split(" · ")[0] ?? id;

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// Rough voiceover pace used everywhere in Stories.
export const WORDS_PER_SEC = 2.4;

export type ScriptLine = { who: string; text: string; narrator: boolean };

// "TITLE: …", "HOOK: …", then "NARRATOR: …" / "NAME: …" lines. Lines without a
// speaker continue the previous line.
export function parseScript(script: string) {
  let title = "";
  let hook = "";
  const lines: ScriptLine[] = [];
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][\w .'’()-]{0,40}?):\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      const up = key.toUpperCase();
      if (up === "TITLE") title = m[2];
      else if (up === "HOOK") hook = m[2];
      else lines.push({ who: key, text: m[2], narrator: up === "NARRATOR" });
    } else if (lines.length) {
      lines[lines.length - 1].text += ` ${line}`;
    } else {
      lines.push({ who: "Narrator", text: line, narrator: true });
    }
  }
  const words = lines.reduce((n, l) => n + wordCount(l.text), 0);
  return { title, hook, lines, words };
}
