import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Easing, Freeze, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Captions, Hook, type OutWord } from "./Clip";
import {
  STORY_FADE_FRAMES,
  shotFrames,
  type CameraMove,
  type StoryCompositionProps,
} from "../types/story";

// Story Studio video (Phase 1): one still per shot with a slow camera move,
// that shot's voiceover, a short crossfade into the next shot, and captions.

const ShotImage: React.FC<{ src: string; camera: CameraMove; frames: number; fadeIn: boolean }> = ({
  src,
  camera,
  frames,
  fadeIn,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, frames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  let scale = 1.06;
  let x = 0;
  if (camera === "push_in") scale = 1.04 + p * 0.14;
  else if (camera === "pull_out") scale = 1.18 - p * 0.14;
  else if (camera === "pan_left") {
    scale = 1.16;
    x = 5 - p * 10;
  } else if (camera === "pan_right") {
    scale = 1.16;
    x = -5 + p * 10;
  } else scale = 1.05 + p * 0.03;
  const opacity = fadeIn ? interpolate(frame, [0, STORY_FADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translateX(${x}%) scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};

// Phase 2: an AI video clip for the shot (made from the still, so it starts on
// the same picture). A clip shorter than the shot is slowed slightly to fit.
// Talking clips (lipSync) always play at normal speed so the lips match the
// voice; if one ends early, its last frame holds.
const ShotVideo: React.FC<{ src: string; frames: number; videoSec?: number | null; lipSync?: boolean; fadeIn: boolean }> = ({
  src,
  frames,
  videoSec,
  lipSync,
  fadeIn,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const need = frames / fps;
  const opacity = fadeIn ? interpolate(frame, [0, STORY_FADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const style = { width: "100%", height: "100%", objectFit: "cover" as const };
  if (lipSync) {
    const clipFrames = videoSec ? Math.max(1, Math.floor(videoSec * fps) - 1) : frames;
    return (
      <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
        <Sequence durationInFrames={Math.min(frames, clipFrames)} layout="none">
          <OffthreadVideo src={src} muted style={style} />
        </Sequence>
        {clipFrames < frames && (
          <Sequence from={clipFrames} layout="none">
            <Freeze frame={clipFrames - 1}>
              <OffthreadVideo src={src} muted style={style} />
            </Freeze>
          </Sequence>
        )}
      </AbsoluteFill>
    );
  }
  const rate = videoSec && videoSec < need ? Math.max(0.6, videoSec / need) : 1;
  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <OffthreadVideo src={src} muted playbackRate={rate} style={style} />
    </AbsoluteFill>
  );
};

// Background music: looped under the voice, 1 s fade in and out.
const Music: React.FC<{ src: string; volume: number; totalFrames: number }> = ({ src, volume, totalFrames }) => {
  const { fps } = useVideoConfig();
  return (
    <Audio
      src={src}
      loop
      volume={(f) =>
        volume *
        interpolate(f, [0, fps, Math.max(fps + 1, totalFrames - fps), totalFrames], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
  );
};

export const StoryComposition: React.FC<StoryCompositionProps> = ({ shots, captionStyle, hook, musicUrl, musicVolume }) => {
  const { fps, durationInFrames } = useVideoConfig();

  const items = useMemo(() => {
    let from = 0;
    return shots.map((s) => {
      const frames = shotFrames(s.durationSec);
      const item = { ...s, from, frames };
      from += frames;
      return item;
    });
  }, [shots]);

  // Caption words on the story timeline.
  const words: OutWord[] = useMemo(
    () => items.flatMap((it) => it.words.map((w) => ({ w: w.w, s: w.s + it.from / fps, e: w.e + it.from / fps }))),
    [items, fps]
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {items.map((it, i) => {
        // Each picture lasts into the next shot so the next one can fade in over it.
        const tail = i < items.length - 1 ? STORY_FADE_FRAMES : 0;
        return (
          <Sequence key={`img-${i}`} from={it.from} durationInFrames={it.frames + tail} premountFor={fps}>
            {it.videoUrl ? (
              <ShotVideo src={it.videoUrl} frames={it.frames + tail} videoSec={it.videoSec} lipSync={it.lipSync} fadeIn={i > 0} />
            ) : it.imageUrl ? (
              <ShotImage src={it.imageUrl} camera={it.camera} frames={it.frames + tail} fadeIn={i > 0} />
            ) : null}
          </Sequence>
        );
      })}
      {items.map((it, i) =>
        it.audioUrl ? (
          <Sequence key={`aud-${i}`} from={it.from} durationInFrames={it.frames} premountFor={fps}>
            <Audio src={it.audioUrl} />
          </Sequence>
        ) : null
      )}
      {musicUrl ? <Music src={musicUrl} volume={musicVolume ?? 0.12} totalFrames={durationInFrames} /> : null}
      {captionStyle !== "none" && words.length > 0 ? (
        <Captions words={words} style={captionStyle} position="bottom" />
      ) : null}
      {hook ? (
        <Sequence from={0} durationInFrames={Math.round(2.6 * fps)}>
          <Hook text={hook} durationSec={2.6} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
