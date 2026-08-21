# Breakdown Frames

A breakdown is an important in-between pose, not just another generated JPEG.

```
F100 KEY  →  F105 BREAKDOWN  →  F110 KEY
```

## Create (not generative)

Between Keyframe A and B:

- **空白 Breakdown** — wipe the interior slot (or insert one if A/B are adjacent) and type it `BREAKDOWN`
- **複製修改** — copy A or B onto the slot, type `BREAKDOWN`, then draw
- **設定 Frame Type** — `KEY | BREAKDOWN | INBETWEEN | HOLD` (never `GENERATED_BREAKDOWN` from this path)
- **AI 建議位置** — `suggest_breakdown_frames` returns 1–3 interior numbers. It **never auto-creates**

`create_breakdown` writes a revision and is undoable. It does **not** run RIFE / linear-blend / Wan.

## Suggest

`suggest_breakdown_frames()` runs when pose displacement is large, direction changes, contact is complex, or occlusion is likely. Low-complexity pairs still get a midpoint suggestion. It **never auto-creates** the frame.

Assist shows:

- [建議分解影格] — fills positions only
- [空白 Breakdown]
- [仍直接生成] (`force=true`)

Generated breakdowns, if produced later, are typed `GENERATED_BREAKDOWN` so they are not mistaken for a human drawing. That path is **not** wired in this round.

Timeline marks: KEY ★ · BREAKDOWN ◆ · GENERATED G · REPAIRED R.
