# Breakdown Frames

A breakdown is an important in-between pose, not just another generated JPEG.

```
F100 KEY  →  F105 BREAKDOWN  →  F110 KEY
```

`suggest_breakdown_frames()` runs when pose displacement is large, direction changes, contact is complex, or occlusion is likely. It **never auto-creates** the frame.

Assist shows:

- [建立 Breakdown]
- [仍直接生成] (`force=true`)

Generated breakdowns, if produced later, are typed `GENERATED_BREAKDOWN` so they are not mistaken for a human drawing.

Timeline marks: KEY ★ · BREAKDOWN ◆ · GENERATED G · REPAIRED R.
