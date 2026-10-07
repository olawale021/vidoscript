import React from "react";
import { Composition } from "remotion";
import { ScenePlan } from "../types/broll";
import { BrollComposition, FPS, aspectDims, planDurationInFrames } from "./Broll";

const EMPTY_PLAN: ScenePlan = {
  version: 1,
  theme: "dark-modern",
  aspect: "9:16",
  scenes: [
    { id: "s1", kind: "motion", template: "TitleCard", props: { title: "B-roll" }, durationSec: 3 },
  ],
};

// Registered composition consumed by @remotion/renderer (the worker). Duration
// and dimensions are derived from the ScenePlan passed as inputProps.
export const RemotionRoot: React.FC = () => (
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
);
