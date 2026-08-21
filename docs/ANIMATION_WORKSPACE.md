# Animation Workspace

The studio (`src/components/workstation/studio-app.tsx`) is a frame-by-frame visual workstation, not an NLE and not a dashboard.

See [VISUAL_WORKSPACE.md](./VISUAL_WORKSPACE.md) for the visual-first contract.

## Core loop

1. Import a video or open **Classic ball**
2. Timeline playhead = current frame (canvas is the center)
3. Onion skin Prev/Next 1–3 (default 2) drawn on the canvas
4. Click a thumbnail for a single frame (clears range). Shift-click to select a range
5. **Region** tool + drag on the canvas to box a hand / object
6. Floating actions: Ask AI / Track / Propagate / Repair here
7. **Ask** (shortcut `A`) — 「這裡為什麼怪怪的？」
8. Context Engine serializes project / timeline / frame / range / region / onion
9. Conversation runtime returns VisualAnnotation; the UI points at the region

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← → or , . | Flipbook |
| O | Onion skin |
| A | Open AI |
| C | Consistency scan |
| ` | Flicker compare |
| H (hold) | Hold to compare |
| F | Focus mode |
| Esc | Clear region / return to fit |
| 1–5 | ANIMATE / ANALYZE / REPAIR / REVIEW / GENERATE |
| Shift-click overlay | Stack overlay |

## Inspector

Problems tab is the default: visual list + face/hand/object strips. Inbetween tab is the generate story. Advanced still has type, duration, lock, raw scores, jobs, revisions.
