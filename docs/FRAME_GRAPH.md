# Frame Graph

A frame is not `003.png`. It is a node:

- `timestamp`, `frame_number`, `type`
- image / thumbnail / hash
- characters, objects, notes, lock
- derived neighbors via `NEXT_FRAME` / `PREVIOUS_FRAME`
- stored edges: `APPEARS_IN`, `GENERATED_FROM`, `REPAIRED_FROM`, `CONTACTS`, …

```
graph.get_frame_window(center=120, before=4, after=4)   → MCP get_frame_window
graph.get_character_track(character_id)                 → MCP get_character_track
graph.get_motion_between(a, b)                          → MCP get_motion_between
graph.get_problem_frames(start, end)                    → MCP get_problem_frames
```

Implemented in `src/lib/domain/frame-graph.ts` plus SQL in `graph_edges` / `frame_characters` / `frame_objects` / `motion_data` / `consistency_results` / `regions` / `keyframes` / `repair_jobs`.

Node kinds: Frame, Character, Object, Pose, Track, Region, Keyframe, Repair. Helpers: `characterNodeId`, `objectNodeId`, `poseNodeId`, `regionNodeId`, `keyframeNodeId`, `repairNodeId`, `trackNodeId`. Pose / SAM masks stay empty until those adapters load — no fake nodes.

Character identity across frames is `Character@Fn SAME_CHARACTER Character@Fn+1` via `frame_characters` (written on assign). Objects get `SAME_OBJECT`. Manual tracking points with the same name write `TRACKS_TO` and `MOVES_TO`. Gaps write `DISAPPEARS`. Occlusion writes `OCCLUDES`. Generated / repaired frames write `GENERATED_FROM` / `REPAIRED_FROM`. Consistency contact events write `CONTACTS` with `payload.kind = CONTACT_BREAK` (tracking-point distance, not a pose model).

`get_character_track` annotates each frame as `visible` | `occluded` | `lost` | `recovered`. Lost is a hole between first and last appearance.
