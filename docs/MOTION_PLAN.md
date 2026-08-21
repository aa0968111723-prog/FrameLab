# Motion Plan

A Motion Plan describes **timing and spacing** between two keys *before* pixels are generated. FrameLab does not dump two JPEGs into a black-box model.

## Contents

- characters + pose transition
- objects + follow constraints
- camera (static / follow / unknown)
- curve: `linear | ease_in | ease_out | ease_in_out | hold` (`custom` reserved)
- breakdown frame numbers (suggestions, not auto-created)
- animation constraints
- `timing.frames` + `timing.fps`
- `spacing[]` — normalized progress `0..1` per generated frame (`motion_progress`)

Ease is not a label. `sampleCurve(count, curve)` writes a different spacing array for linear vs ease-in-out.

## Versioning

Plans are **insert-only**. Changing Linear → Ease In Out creates version N+1. Old rows stay.

`hashMotionPlan` is part of the generation cache key. A curve or constraint change cannot reuse old pixels.
