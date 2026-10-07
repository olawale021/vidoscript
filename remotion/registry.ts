import React from "react";
import { NATIVE_TEMPLATE_COMPONENTS, TemplateProps } from "./templates";
import { RVE_TEMPLATE_COMPONENTS } from "./templates-rve";

// The full template palette the planner can mix from: native + RVE-adapted.
export const TEMPLATE_COMPONENTS: Record<string, React.FC<TemplateProps>> = {
  ...NATIVE_TEMPLATE_COMPONENTS,
  ...RVE_TEMPLATE_COMPONENTS,
};
