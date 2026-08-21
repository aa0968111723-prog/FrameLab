# Data model

See `migrations/0002_framelab.sql` and `migrations/0003_spec_gaps.sql`.

`projects`, `videos`, `timelines`, `frames`, `keyframes`, `characters`, `objects`, `frame_characters`, `frame_objects`, `graph_edges`, `consistency_results`, `jobs`, `repair_jobs`, `revisions`, `mcp_clients`, `mcp_audit_logs`, `model_runs`, `analysis_cache`, `tracking_points`, `tracking_tracks`, `motion_data`, `poses`, `depth_maps`, `segmentations`.

Frame: `id`, `timeline_id`, `frame_number`, `timestamp_ms`, `duration_ms`, `frame_type`, `image_data`, `thumbnail_data`, `width`, `height`, `is_locked`, `notes`, `content_hash`.

Character: `id`, `project_id`, `name`, `notes`, `reference_image`, `embedding` (optional), `metadata_json`.

V0.3: `keyframe_pairs`, `motion_plans` (versioned rows), `candidate_versions`, `generated_frame_issues`. Frames gained `exposure_count` (default 1) for future ones/twos/threes. Job type `GENERATE_INBETWEENS`. Edge types `GENERATED_FROM`, `BETWEEN`.

