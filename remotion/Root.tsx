import React from "react";
import { Composition } from "remotion";
import { ScenePlan } from "../types/broll";
import { BrollComposition, FPS, aspectDims, planDurationInFrames } from "./Broll";
import { ClipComposition, clipDurationInFrames } from "./Clip";
import { CLIP_DEFAULTS, CLIP_DIMS, CLIP_FPS, type ClipCompositionProps } from "../types/clip";
import { StoryComposition } from "./Story";
import { STORY_DIMS, STORY_FPS, storyDurationInFrames, type StoryCompositionProps } from "../types/story";

const EMPTY_STORY: StoryCompositionProps = { shots: [], aspect: "9:16", captionStyle: "bold", hook: null };

const EMPTY_PLAN: ScenePlan = {
  version: 1,
  theme: "dark-modern",
  aspect: "9:16",
  scenes: [
    { id: "s1", kind: "motion", template: "TitleCard", props: { title: "B-roll" }, durationSec: 3 },
  ],
};

const EMPTY_CLIP: ClipCompositionProps = {
  videoUrl: "",
  videoOffsetSec: 0,
  start: 0,
  end: 5,
  words: [],
  smart: null,
  ...CLIP_DEFAULTS,
};

// Registered compositions consumed by @remotion/renderer (the worker). Duration
// and dimensions are derived from the inputProps.
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Broll"
      component={BrollComposition}
      defaultProps={{ plan: EMPTY_PLAN }}
      fps={FPS}
      durationInFrames={90}
      width={1080}
      height={1920}
      calculateMetadata={({ props }) => {
        const plan = (props as { plan: ScenePlan }).plan;
        const dims = aspectDims(plan.aspect);
        return {
          durationInFrames: planDurationInFrames(plan),
          fps: FPS,
          width: dims.width,
          height: dims.height,
        };
      }}
    />
    <Composition
      id="Clip"
      component={ClipComposition}
      defaultProps={EMPTY_CLIP}
      fps={CLIP_FPS}
      durationInFrames={150}
      width={1080}
      height={1920}
      calculateMetadata={({ props }) => {
        const p = props as ClipCompositionProps;
        const dims = CLIP_DIMS[p.aspect] ?? CLIP_DIMS["9:16"];
        return {
          durationInFrames: clipDurationInFrames(p),
          fps: CLIP_FPS,
          width: dims.width,
          height: dims.height,
        };
      }}
    />
    <Composition
      id="Story"
      component={StoryComposition}
      defaultProps={EMPTY_STORY}
      fps={STORY_FPS}
      durationInFrames={150}
      width={1080}
      height={1920}
      calculateMetadata={({ props }) => {
        const p = props as StoryCompositionProps;
        const dims = STORY_DIMS[p.aspect] ?? STORY_DIMS["9:16"];
        return { durationInFrames: storyDurationInFrames(p), fps: STORY_FPS, width: dims.width, height: dims.height };
      }}
    />
  </>
);
