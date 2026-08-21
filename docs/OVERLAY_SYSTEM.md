# Overlay System

All pose, motion, tracking, mask, problem, and AI markers go through one transform:

```
Frame coordinates (pixels or 0–1)
  → ViewportTransform (fit + zoom + pan)
  → overlay draw
```

Implementation: `src/lib/visual/viewport.ts` + `src/lib/visual/overlay-renderer.ts`.

Overlays never keep their own scale. Zoom/pan cannot misalign a skeleton vs the pixels.

## Layers

Default stack (spec §58): **original + one main overlay + problem markers**.

Switcher under the canvas:

Original · Onion · Pose · Motion · Track · Mask · Problems · Compare

Shift-click stacks up to three extras. Pose + flow + mask + heatmap are never all on by default.

Pose ghost draws previous (cool) and next (warm) skeletons under the current pose. Selecting a joint dims the rest of the chain.

Motion / track draw a single trail (head, hands, hip, foot, object, custom) — not every point at once.

## Coordinates

Spatial annotations are **normalized 0–1**. Pixel inputs are converted with `toNormalized`. MCP returns `VisualAnnotation`; the frontend renders. MCP never sends CSS selectors or DOM commands.
