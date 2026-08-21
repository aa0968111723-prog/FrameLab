# Region Repair UX

Real pipeline — never bbox blend as AI:

1. **選區** — drag a box, or click SAM 2 on a character/object.
2. **遮罩** — SAM 2 contour when present; otherwise a rectangle mask labelled as such (not SAM 2).
3. **時間脈絡** — neighboring frames (default ±2) shown as references.
4. **候選** — generative provider writes a candidate, not the active timeline.
5. **前後比較** — compare overlay, then Accept / Reject.

「在此修復」 calls `regenerate_region` with `method=generative`. If Wan is not loaded the UI shows **生成修復尚未設定** and writes no pixels.

「快速預覽」 is neighborhood bbox paste. It is **not** AI repair.

```
repair_region({ frames, masks, references, constraints, temporal_context })
```

`BlendRegionRepair` is unavailable. `SamRegionRepair` returns masks-only (not inpaint).
