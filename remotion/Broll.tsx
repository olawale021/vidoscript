import React from "react";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Aspect, ScenePlan } from "../types/broll";
import { getTheme } from "./theme";
import { TitleCard } from "./templates";
import { TEMPLATE_COMPONENTS } from "./registry";

export const FPS = 30;
const TRANSITION_FRAMES = 12; // scene overlap; scenes are ≥30 frames (1s min)

export function aspectDims(aspect: Aspect): { width: number; height: number } {
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 }; // 9:16 default
}

function sceneFrames(durationSec: number): number {
  return Math.max(1, Math.round((durationSec || 3) * FPS));
}

// Transitions overlap adjacent scenes, so total = sum(scenes) - overlaps.
export function planDurationInFrames(plan: ScenePlan): number {
  const total = plan.scenes.reduce((a, s) => a + sceneFrames(s.durationSec), 0);
  const overlaps = Math.max(0, plan.scenes.length - 1) * TRANSITION_FRAMES;
  return Math.max(1, total - overlaps);
}

// Root composition: scenes in sequence with pack-appropriate transitions.
// Used by @remotion/player (preview) and the render worker (MP4).
export const BrollComposition: React.FC<{ plan: ScenePlan }> = ({ plan }) => {
  const theme = getTheme(plan.theme);
  const presentation =
    theme.transition === "slide" ? slide({ direction: "from-right" }) : fade();
  const timing = linearTiming({ durationInFrames: TRANSITION_FRAMES });

  return (
    <TransitionSeries>
      {plan.scenes.map((scene, i) => {
        const Comp = TEMPLATE_COMPONENTS[scene.template] || TitleCard;
        return (
          <React.Fragment key={scene.id}>
            {i > 0 && (
              <TransitionSeries.Transition presentation={presentation} timing={timing} />
            )}
            <TransitionSeries.Sequence durationInFrames={sceneFrames(scene.durationSec)}>
              <Comp
                props={scene.props}
                theme={theme}
                caption={scene.caption}
                query={scene.query}
                assetRef={scene.assetRef}
                assetType={scene.assetType}
              />
            </TransitionSeries.Sequence>
          </React.Fragment>
        );
      })}
    </TransitionSeries>
  );
};
