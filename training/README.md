# FrameLab consistency training (reserved)

No model is trained in v0.1. This tree exists so future datasets have a place to land.

```
training/
  dataset-schema/   JSON schema for labeled windows
  exporters/        dump frame windows + metrics
  labeling/         notes for human raters
```

Input per sample: previous frames, current, next, pose, flow, mask, depth, tracking, character id, object id.

Labels: face_consistency, hand_consistency, motion_consistency, object_consistency, bad_region, repair_window.

Do not check in fake labels.
