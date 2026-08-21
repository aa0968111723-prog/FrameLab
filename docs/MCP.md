# MCP

Endpoint: `POST /api/mcp`  
Auth: `Authorization: Bearer fl_…` (issued in the studio, hashed at rest)  
Protocol: JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`)

MCP never talks to the React tree. It never imports SAM/RIFE/Wan. It calls `executeTool`.

## Resources

- `framelab://projects`
- `framelab://projects/{id}`
- `framelab://videos/{id}`
- `framelab://timelines/{id}`
- `framelab://frames/{id}`
- `framelab://frames/{id}/analysis`
- `framelab://frames/{id}/neighbors`
- `framelab://characters/{id}`
- `framelab://characters/{id}/track`
- `framelab://objects/{id}`
- `framelab://objects/{id}/track`
- `framelab://jobs/{id}`
- `framelab://models`
- `framelab://system/status`
- `framelab://sessions/{session_id}/context` — serialized workspace context (session-isolated)
- `framelab://session/{session_id}/context` — alias of the session context resource
- `framelab://conversations/{conversation_id}` — messages, linked frames/ranges, snapshots
- `framelab://keyframe-pairs/{id}`
- `framelab://motion-plans/{id}`
- `framelab://generation-jobs/{id}`
- `framelab://candidates/{id}`
- `framelab://generated-frames/{id}`

## Tools

Read / analyze / edit / generate / render as listed in `src/lib/mcp/catalog.ts`. Graph helpers: `get_frame_window`, `get_motion_between`, `get_character_track`, `get_object_track`, `get_problem_frames`, `get_graph`, `get_frame_analysis`, `get_frame_neighbors`.

`get_frame_neighbors` returns metadata + `thumbnailRef` (`frame:{id}:thumb`). Never JPEG binary. `frameId` optional — with only `sessionId` it uses the session's current frame. Default window is before=2 / after=2.

Visual tools return `VisualAnnotation` (POINT / REGION / PATH / LABEL / RANGE, 0–1 coordinates). Frontend renders. MCP never sends CSS selectors or DOM commands.

- `get_visual_context`
- `annotate_frame`
- `highlight_region`
- `highlight_frame_range`
- `get_motion_path`
- `get_pose_overlay`
- `get_tracking_overlay`
- `get_problem_regions`
- `focus_problem` (returns frame + annotation; UI seeks)
- `compare_frames_visual`
- `list_visual_annotations`

See [VISUAL_ANNOTATIONS.md](./VISUAL_ANNOTATIONS.md), [OVERLAY_SYSTEM.md](./OVERLAY_SYSTEM.md), [VISUAL_AI_INTERACTION.md](./VISUAL_AI_INTERACTION.md).

Workspace context (session-isolated, ASK-safe): `get_current_context`, `get_current_frame`, `get_selected_frames`, `get_selected_frame_range` (alias `get_selected_range`), `get_selected_region`, `get_current_character`, `get_current_object`, `analyze_selection`, `analyze_motion_context`. Invalid session → `FRAME_NOT_FOUND`. Missing `sessionId` → `VALIDATION_ERROR`. `analyze_selection` is **lightweight visual analysis** (pixel MAE / histogram / luma centroid / 16×16 block) — never pose. `get_current_context` returns the spec fields including `conversation_id` and `analysis_available`. See [MCP_CONTEXT.md](./MCP_CONTEXT.md).

V0.3 inbetween: `create_keyframe_pair`, `analyze_keyframe_transition`, `create_motion_plan`, `suggest_breakdown_frames`, `create_inbetween_plan` are SUGGEST/ANALYZE. `create_breakdown` is EDIT (blank / copy / mark between A/B, never generative). `generate_inbetweens` / `regenerate_inbetween_range` need GENERATE + `confirmed=true`. `accept_generated_frames` needs EDIT + confirm and writes a revision. ASK/ASSIST conversations cannot call generate or accept.

`generate_inbetweens` writes a **candidate**, not the live timeline. Default provider is **RIFE**. `linear-blend` is 快速預覽 only (not AI inbetweening).


V0.2 Assist tools (READ+ANALYZE+SUGGEST, still no auto-edit): `suggest_repair`, `create_repair_plan`, `get_problem_ranges`, `get_repair_plan`, `compare_before_after`, `analyze_pose` (pose-lite). `execute_repair_plan` / `accept_revision` / `restore_revision` are EDIT and are denied in ASK/ASSIST conversations.

Character tracking: `assign_character_range`, `set_character_visibility`. `get_character_track` returns `annotated` statuses (`visible` / `occluded` / `lost` / `recovered`). Lost is a hole between first and last appearance — not a tracker model.

Point tracking: `create_tracking_point` (default `track=true`) and `analyze_tracking` / `rerun_tracking` run **framelab-ncc** (real NCC template matching). `provider=locotrack` returns `MODEL_NOT_AVAILABLE`. Trails write `TRACKS_TO` / `MOVES_TO` edges.

Stdio transport: `node apps/mcp-server/stdio.mjs` proxies JSON-RPC lines to `/api/mcp`.

High-risk tools (`delete_frame`, `replace_frame`, `repair_frame_range`, `regenerate_region`, `extract_video`, `ingest_frames`) write revisions and audit rows. Analyze / interpolate / repair / render **create jobs**; poll `get_job`. `cancel_job` marks queued/running jobs cancelled.

`regenerate_region` with `x,y,w,h` is a real bbox blend (not Wan). Named region without a bbox → `MODEL_NOT_AVAILABLE`. `list_mcp_clients` is ADMIN and never returns token hashes.

`undo` restores the latest frame snapshot. `list_audit_logs` is ADMIN. `create_sample_project` and `ingest_frames` let agents seed a timeline without the UI.

`render_preview` concatenates JPEG frames with FFmpeg into `data/projects/{id}/renders/preview.mp4`. Browser MediaRecorder export remains the download path.

## Prompts

`analyze_animation_problem`, `analyze_character_motion`, `analyze_hand_consistency`, `analyze_object_contact`, `suggest_repair_window`, `repair_animation_range`, `generate_inbetweens`, `ask_about_selection`

`ask_about_selection` is ASK/read-only: load session context, region, then `analyze_selection`. Do not invent pose metrics. Do not edit frames.

Hand/contact prompts tell the agent the pose model is not loaded. Contact from manual tracking points is rule-based distance, labelled as such.

## Client

`packages/mcp-client` — `initialize`, `listTools`, `callTool`, `listResources`, `readResource`. Outbound registry is optional; FrameLab starts without it.
