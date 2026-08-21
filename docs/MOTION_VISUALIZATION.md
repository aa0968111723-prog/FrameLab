# Motion Visualization

Numbers stay in Advanced. The canvas shows the motion.

## Onion skin

Previous 1–3 (cool tint) under the current frame, next 1–3 (warm tint) over it. Moving the playhead updates immediately.

## Onion motion trail

The selected trail (e.g. right wrist) is drawn across nearby frames as a fading path. A jump is a gap or a warning tick, not a magnitude score.

## Motion path

Tracking trail polyline for one target: Head, Left/Right Hand, Hip, Foot, Object, Custom. SEA-RAFT also advects the strongest flow samples as short two-point paths on the motion overlay.

## Pose ghost

Previous / current / next skeletons. Selecting a joint (right wrist) highlights that kinematic chain and dims the rest.

## Motion arrows

Sampled **SEA-RAFT** vectors (sparse on purpose). Live block-match arrows appear only when no SEA-RAFT grid has been written yet (CPU fallback).

## Heatmap

Theme-aware amber intensity of frame-to-frame change. No rainbow LUT.

## Spacing / curve

The strip under the timeline is the animator’s spacing chart:

- Linear · even
- Ease in · packing later
- Ease out · packing earlier
- Ease in-out · slow–fast–slow
