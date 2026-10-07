# Third-party templates — reactvideoeditor (RVE)

The `.tsx` files in this folder are the **81 free Remotion templates** from:

- Repo: https://github.com/reactvideoeditor/remotion-templates
- Site / live demos: https://www.reactvideoeditor.com/remotion-templates

## License

The GitHub repo has **no top-level LICENSE file**, but **every template file
carries an explicit per-file grant** in its header comment:

> "This template is free to use in your projects! Credit appreciated but not
> required. Created by the team at https://www.reactvideoeditor.com"

That per-file grant is preserved verbatim in each vendored file. We credit RVE
here as appreciation. If you later use these commercially at scale, confirm the
current terms on their site.

## How these are used

- These raw files are **reference source**. They are propless demo components
  (hardcoded content), not wired to our `ScenePlan` contract.
- The ones adapted for the AI planner live in `remotion/templates-rve.tsx`,
  where they are parameterized (props/theme/caption) and registered in the
  template catalog so the planner can mix them with the native templates.
- Un-adapted files remain here for future adaptation.
