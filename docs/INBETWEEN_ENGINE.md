# Inbetween Engine

Pipeline:

```
Keyframe Pair
  → Transition analysis (block-match-16 + pose-lite + similarity)
  → Complexity LOW | MEDIUM | HIGH | VERY_HIGH
  → InbetweenStrategyResolver
  → Motion Plan
  → Provider.generate (candidate only)
  → Consistency evaluation
  → Minimal regeneration of bad frames
  → Accept / Reject / Restore
```

## Strategy

| Complexity | Strategy |
| --- | --- |
| LOW | linear-blend interpolation |
| MEDIUM | linear-blend + motion curve |
| HIGH | generative if available, else linear-blend + warning |
| VERY_HIGH | suggest breakdown; generate only with `force=true` |

Wan / RIFE / fal.ai / ComfyUI adapters exist and return `PROVIDER_NOT_AVAILABLE` / `MODEL_NOT_AVAILABLE`. They never invent pixels.

## Candidate first

`generate_inbetweens` writes a **candidate timeline version**. The active timeline does not change until `accept_generated_frames` (EDIT + `confirmed=true`). Accept creates a revision first. KEY / HOLD / LOCKED / BREAKDOWN frames are never rewritten.

Export writes a PNG sequence `frame_0001.png` … into `renders/`. JPEG is not used for sequence export.

Preview generation downscales to max 960px wide (`GenerationResolutionPolicy`). Production keeps source resolution. Cache keys include the resolved size.

Accept writes `GENERATED_FROM` from both keys onto each generated frame, plus `BETWEEN` and sequential `NEXT_FRAME` / `PREVIOUS_FRAME`. Never a self-loop.

`generate_breakdown_frame` interpolates a midpoint and marks it `GENERATED_BREAKDOWN` — never a human KEY/BREAKDOWN. Requires `confirmed=true`.


Regenerate writes a **new** candidate (previous kept) and re-runs consistency. Compare A/B shows the previous candidate vs the new one.

## HOLD vs movement

A HOLD curve keeps spacing at 0 until the last sample. Existing HOLD frames on the timeline are protected on accept.
