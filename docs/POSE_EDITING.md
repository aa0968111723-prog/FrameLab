# Pose Editing

Canvas skeleton joints can be dragged. The image is **not** rewritten.

```
骨架 overlay → drag joint → PoseConstraint + Revision
```

## Behaviour

- Open **骨架**. Joints become handles.
- Drag a joint. The overlay updates immediately.
- On release, FrameLab writes:
  - updated `poses.joints_json` (metadata only)
  - a `PoseConstraint` (`POSE_JOINT`, user source)
  - a Revision (`edit_pose`) so Undo/Restore works
- `replace_frame` / pixels are never touched.

No pose on the frame → nothing to drag. Run **姿態分析** first.

## Undo

`undo` / `restore_revision` restores previous joints and the constraint list for that frame. Still no pixel write.
