import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// Script text helpers shared by Convex functions: "TITLE: …", "HOOK: …", then
// "SPEAKER: text" lines (a line without a speaker continues the previous one).
// Mirrors parseScript in app/(dashboard)/dashboard/stories/_components/util.ts.

export type Line = { who: string; text: string };

export function splitScript(script: string) {
  let title = "";
  let hook = "";
  const lines: Line[] = [];
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][\w .'’()-]{0,40}?):\s*(.*)$/);
    if (m) {
      const up = m[1].trim().toUpperCase();
      if (up === "TITLE") title = m[2];
      else if (up === "HOOK") hook = m[2];
      else lines.push({ who: m[1].trim(), text: m[2] });
    } else if (lines.length) {
      lines[lines.length - 1].text += ` ${line}`;
    } else {
      lines.push({ who: "NARRATOR", text: line });
    }
  }
  return { title, hook, lines };
}

export function joinScript({ title, hook, lines }: { title: string; hook: string; lines: Line[] }) {
  const head = [title ? `TITLE: ${title}` : "", hook ? `HOOK: ${hook}` : ""].filter(Boolean).join("\n");
  const body = lines.map((l) => `${l.who}: ${l.text.replace(/\s+/g, " ").trim()}`).join("\n");
  return head ? `${head}\n\n${body}` : body;
}

// Save the current script as an Undo point before changing it.
export const HISTORY_MAX = 10;
export async function pushScriptHistory(ctx: MutationCtx, story: Doc<"stories">, label: string) {
  if (!story.script?.trim()) return;
  const history = story.scriptHistory ?? [];
  if (history.length && history[history.length - 1].script === story.script) return;
  const next = [...history, { script: story.script, title: story.title, hook: story.hook ?? undefined, label, at: Date.now() }].slice(-HISTORY_MAX);
  await ctx.db.patch(story._id, { scriptHistory: next });
}
