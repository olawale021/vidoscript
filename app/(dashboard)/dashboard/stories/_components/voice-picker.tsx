"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { STORY_VOICES } from "@/types/story";

// Short pre-recorded sample per voice: public/voices/<id>.mp3 (same model and
// narrator style as real stories). One shared player so only one plays at a time.
let player: HTMLAudioElement | null = null;
const listeners = new Set<(id: string | null) => void>();
let playingId: string | null = null;

function setPlaying(id: string | null) {
  playingId = id;
  listeners.forEach((l) => l(id));
}

export function toggleVoice(id: string) {
  if (typeof window === "undefined") return;
  player ??= new Audio();
  if (playingId === id) {
    player.pause();
    setPlaying(null);
    return;
  }
  player.pause();
  player.src = `/voices/${id}.mp3`;
  player.onended = () => setPlaying(null);
  player.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
}

function usePlaying() {
  const [id, setId] = useState<string | null>(playingId);
  useEffect(() => {
    listeners.add(setId);
    return () => {
      listeners.delete(setId);
    };
  }, []);
  return id;
}

// Small ▶ button to hear one voice (used next to the character voice menus).
export function VoicePreviewButton({ voice, className }: { voice: string; className?: string }) {
  const playing = usePlaying() === voice;
  return (
    <button
      type="button"
      aria-label={playing ? "Stop voice sample" : "Play voice sample"}
      onClick={() => toggleVoice(voice)}
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center border transition flex-shrink-0",
        playing ? "border-accent text-accent bg-accent-soft" : "border-line-strong text-muted hover:text-fg",
        className
      )}
    >
      {playing ? <Pause size={12} className="fill-current" /> : <Play size={12} className="ml-0.5 fill-current" />}
    </button>
  );
}

// Grid of voices: tap ▶ to listen, tap the card to choose.
export function VoicePicker({
  value,
  onChange,
  favourite,
}: {
  value: string;
  onChange: (id: string) => void;
  favourite?: string | null;
}) {
  const playing = usePlaying();
  return (
    <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2" role="radiogroup" aria-label="Narrator voice">
      {STORY_VOICES.map((v) => {
        const selected = v.id === value;
        const on = playing === v.id;
        const [name, desc] = v.label.split(" · ");
        return (
          <li key={v.id} className="min-w-0">
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 transition min-w-0",
                selected ? "border-fg bg-surface-2" : "border-line hover:border-line-strong"
              )}
            >
              <button
                type="button"
                aria-label={on ? `Stop ${name}` : `Play ${name}`}
                onClick={() => toggleVoice(v.id)}
                className={cn(
                  "w-8 h-8 rounded-full border grid place-items-center flex-shrink-0 transition",
                  on ? "border-accent text-accent bg-accent-soft" : "border-line-strong text-fg hover:bg-surface-3"
                )}
              >
                {on ? <Pause size={11} className="fill-current" /> : <Play size={11} className="ml-0.5 fill-current" />}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(v.id)}
                className="flex-1 min-w-0 text-left py-0.5"
              >
                <b className="block text-[13px] font-semibold text-fg">{name}</b>
                <small className="block text-[11px] text-faint truncate capitalize">{desc}</small>
                {favourite === v.id && <span className="block text-[10px] text-accent">Your favourite</span>}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
