# Visual Annotations

Schema (`src/lib/domain/visual-annotation.ts`):

```
id
frame_id?
frame_number
type: POINT | REGION | PATH | LABEL | RANGE
coordinates   POINT [x,y]  REGION [x,y,w,h]  PATH [x,y,…]  RANGE [start,end]
label
severity
source: ai | user | engine
linked_analysis_id?
category?
```

Spatial coordinates are 0–1. RANGE coordinates are frame numbers.

## MCP tools

`get_visual_context` · `annotate_frame` · `highlight_region` · `highlight_frame_range` · `get_motion_path` · `get_pose_overlay` · `get_tracking_overlay` · `get_problem_regions` · `focus_problem` · `compare_frames_visual` · `list_visual_annotations`

`focus_problem` returns `{ annotation, frame, range, action: "FOCUS" }`. The frontend seeks and zooms. MCP does not touch the DOM.

AI pointers render as a labeled marker on the canvas. Problem ranges render on the timeline as a continuous band you can click.
