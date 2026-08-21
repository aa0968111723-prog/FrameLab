# Context Engine

Domain module: `src/lib/domain/context-engine.ts`  
Package re-export: `packages/context-engine`

Context is **not** React state. The workstation derives a `FrameLabContext` from the timeline engine + region/character selection, serializes it, and syncs it to `workspace_sessions`. MCP and the conversation runtime always read that session — never the browser tree.

## Fields

| Field | Meaning |
| --- | --- |
| `project_id` / `video_id` / `timeline_id` | Scope (`video_id` from the current timeline) |
| `current_frame` | Playhead frame number + id + timestamp |
| `selected_range` | Inclusive `[start, end]` |
| `selected_frames` | Discrete selection |
| `selected_character` / `selected_object` | Semantic focus |
| `selected_region` | Rectangle (or reserved mask) in **normalized 0–1** coords |
| `onion_skin` | Previous/next count (capped at 3) + opacity |
| `overlay` | Which analysis overlay is on |
| `viewport` | Canvas zoom (not dumped as pixels) |
| `analysis_available` | Honest list (`lightweight visual analysis`, never fake pose) |
| `session_id` | Workspace session MCP uses |
| `context_version` | Bumps on every meaningful change |
| `focus` | Highest-priority of region → range → frame → timeline → project |

## Priority

`selected_region` > `selected_frame_range` > `current_frame` > `current_timeline` > `current_project`

## Lock vs follow

A conversation can **lock** a snapshot. Later seeks do not move that thread's effective context. Unlocked threads **follow** the workspace. If `context_version` moved since the last answer, the UI marks:

> This answer refers to an earlier selection.

## Region

Store normalized 0–1. Convert at the frame boundary with `pixelsFromNormalized` / `normalizedFromPixels`. Crops sent to vision get ~15% padding (`paddedNormalizedRegion`) and are downsampled — never raw 4K.

`ContextSerializer.serialize` / `hydrate` and `ContextResolver.resolve` / `focus` / `lock` / `isStale` are the named entry points the spec asked for. MCP and the conversation runtime call these — never React state.

## Session isolation

`workspace_sessions.id` is per browser tab (`sessionStorage`) and owned by `user_id`. MCP `get_current_context` refuses another user's session with `FRAME_NOT_FOUND` ("Workspace session not found") — no existence leak across projects.
