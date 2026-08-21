# Region Repair UX

1. Region tool — drag a box on the canvas.
2. Floating actions: **Ask AI · Track · Propagate ±5 · Repair here · Clear**.
3. Propagate copies the rectangle along the nearest track. Timeline shows mask status (ok / warn / lost). Lost frames get a visual tick — SAM2 is still `MODEL_NOT_AVAILABLE`.
4. Repair window paints on the timeline. Protected keys cannot be covered. Copy: **Only F106 will change.**
5. Confirm runs `regenerate_region` / `repair_frame_range` (blend adapter). Face / hair / clothing locks are **evaluation only** on linear-blend.

Provider interface (`src/lib/domain/region-repair.ts`):

```
repair_region({ frames, masks, references, constraints, temporal_context })
```

`BlendRegionRepair` is available. `SamRegionRepair` returns `MODEL_NOT_AVAILABLE`.
