# REST API

Same command layer as the UI and MCP. Failures return `{ ok: false, code, error }`.

## Query style

```
POST /api/v1?tool=get_frame
Authorization: Bearer fl_…   # or session cookie
Content-Type: application/json

{ "timelineId": "…", "frameNumber": 12 }
```

## Spec paths (also mapped)

| Method | Path | Tool |
| --- | --- | --- |
| POST | `/api/v1/projects` | `create_project` |
| GET | `/api/v1/projects` | `list_projects` |
| GET | `/api/v1/projects/:id` | `get_project` |
| POST | `/api/videos` | multipart FFmpeg ingest |
| GET | `/api/v1/videos/:id` | `get_video` |
| POST | `/api/v1/videos/:id/extract` | `extract_video` |
| GET | `/api/v1/timelines/:id` | `get_timeline` |
| GET | `/api/v1/frames/:id` | `get_frame` |
| GET | `/api/v1/frames/:id/analysis` | `get_frame_analysis` |
| GET | `/api/v1/frames/:id/neighbors` | `get_frame_neighbors` |
| POST | `/api/v1/frames/:id/analyze` | `analyze_frame` |
| POST | `/api/v1/frames/analyze-range` | `analyze_frame_range` |
| POST | `/api/v1/keyframes` | `create_keyframe` |
| POST | `/api/v1/keyframes/range` | `create_keyframe_range` |
| GET | `/api/v1/keyframes?timelineId=` | `get_keyframes` |
| DELETE | `/api/v1/keyframes/:id` | `remove_keyframe` |
| POST | `/api/v1/interpolate` | `interpolate_frames` (legacy immediate write) |
| POST | `/api/v1/keyframe-pairs` | `create_keyframe_pair` |
| GET | `/api/v1/keyframe-pairs/:id` | `get_keyframe_pair` |
| POST | `/api/v1/keyframe-pairs/:id/analyze` | `analyze_keyframe_transition` |
| POST | `/api/v1/motion-plans` | `create_motion_plan` |
| GET | `/api/v1/motion-plans/:id` | `get_motion_plan` |
| POST | `/api/v1/inbetweens/plan` | `create_inbetween_plan` |
| POST | `/api/v1/inbetweens/generate` | `generate_inbetweens` (candidate; needs `confirmed`) |
| GET | `/api/v1/inbetweens/jobs/:id` | `get_generation_job` |
| POST | `/api/v1/inbetweens/:candidate/evaluate` | `evaluate_inbetweens` |
| POST | `/api/v1/inbetweens/:candidate/regenerate` | `regenerate_inbetween_range` |
| POST | `/api/v1/inbetweens/:candidate/accept` | `accept_generated_frames` |
| POST | `/api/v1/inbetweens/:candidate/reject` | `reject_generated_frames` |
| POST | `/api/v1/export/sequence` | `export_frame_sequence` (PNG) |
| GET | `/api/v1/candidates?timelineId=` | `list_candidates` |
| POST | `/api/v1/repair/frame` | `repair_frame` |
| POST | `/api/v1/repair/range` | `repair_frame_range` |
| POST | `/api/v1/repair/region` | `regenerate_region` |
| POST | `/api/v1/render` | `render_animation` |
| GET | `/api/v1/jobs/:id` | `get_job` |
| POST | `/api/v1/jobs/:id/cancel` | `cancel_job` |
| GET | `/api/v1/models` | `get_model_status` |
| GET | `/api/v1/models/status` | `get_model_status` |
| GET | `/api/v1/characters/:id/track` | `get_character_track` |
| GET | `/api/v1/objects/:id/track` | `get_object_track` |
| GET | `/api/v1/sessions/:id/context` | `get_current_context` |
| GET | `/api/v1/sessions/:id/frame` | `get_current_frame` |
| GET | `/api/v1/sessions/:id/frames` | `get_selected_frames` |
| GET | `/api/v1/sessions/:id/range` | `get_selected_frame_range` |
| GET | `/api/v1/sessions/:id/region` | `get_selected_region` |
| GET | `/api/v1/sessions/:id/character` | `get_current_character` |
| GET | `/api/v1/sessions/:id/object` | `get_current_object` |
| GET | `/api/v1/context?sessionId=` | `get_current_context` |
| POST | `/api/v1/analyze/selection` | `analyze_selection` |
| POST | `/api/v1/analyze/motion-context` | `analyze_motion_context` |
| POST | `/api/v1/compare/frames` | `compare_frames` |
| POST | `/api/v1/analysis/motion` | `analyze_motion` |
| POST | `/api/v1/analysis/pose` | `analyze_pose` |
| POST | `/api/v1/analysis/tracking` | `analyze_tracking` |
| POST | `/api/v1/analysis/consistency` | `analyze_consistency` |
| GET | `/api/v1/problem-ranges?timelineId=` | `get_problem_ranges` |
| POST | `/api/v1/repair-plans` | `create_repair_plan` |
| GET | `/api/v1/repair-plans/:id` | `get_repair_plan` |
| POST | `/api/v1/repair-plans/:id/execute` | `execute_repair_plan` |
| POST | `/api/v1/revisions/:id/restore` | `restore_revision` |
| GET | `/api/v1/revisions/:id/compare` | `compare_before_after` |
| GET | `/api/health` | health |
| GET | `/api/system/devices` | devices |
| GET\|POST | `/api/mcp` | MCP |

`regenerate_region` blends **only** a bbox (`x,y,w,h`) from neighbor frames onto the current frame. Named regions (`hand`, `face`, …) without a bbox return `MODEL_NOT_AVAILABLE` (SAM2 is not loaded). `method=generative` returns `PROVIDER_NOT_AVAILABLE`.

TypeScript client: `packages/sdk`.
