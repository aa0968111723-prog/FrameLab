# Motion Visualization

Numbers stay in Advanced. The canvas shows the motion.

## Onion skin

Previous 1–3 (cool tint) under the current frame, next 1–3 (warm tint) over it. Moving the playhead updates immediately.

## Onion motion trail

The selected trail (e.g. right wrist) is drawn across nearby frames as a fading path. A jump is a gap or a warning tick, not a magnitude score.

## Motion path

Full-path polyline for one target: Head, Left/Right Hand, Hip, Foot, Object, Custom. Current frame is a brighter node. Lost / low-confidence samples mark `!`.

## Pose ghost

Previous / current / next skeletons. Selecting a joint (right wrist) highlights that kinematic chain and dims the rest.

## Motion arrows

Sampled block-match vectors (not a full optical-flow field). Sparse on purpose.

## Heatmap

Theme-aware amber intensity of frame-to-frame change. No rainbow LUT.

## Spacing / curve

The strip under the timeline is the animator’s spacing chart:

- Linear · even
- Ease in · packing later
- Ease out · packing earlier
- Ease in-out · slow–fast–slow
