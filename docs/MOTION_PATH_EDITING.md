# Motion Path Editing

Select **右手** or a tracking point, then drag one frame’s control point.

```
Trail overlay → drag one path handle → MotionConstraint + Revision
```

## Behaviour

- Choosing 右手 / 左手 / 頭 / 髖 / 腳 / 追蹤點 shows that trail.
- Pose analysis can fill the path when no LocoTrack samples exist.
- Drag **one frame** of the path. Other frames stay put.
- On release FrameLab writes:
  - that frame’s `tracking_points` row (insert or update)
  - a `MotionConstraint` (`MOTION_PATH`)
  - a Revision (`edit_motion_path`)
- Frame pixels, `frame_type`, and the keyframes table are **never** touched.

## Undo

`undo` / `restore_revision` restores the previous point (or deletes a newly inserted one) and the constraint list for that trail+frame.
