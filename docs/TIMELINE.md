# Timeline engine

Pure state, no React. `src/lib/domain/timeline-engine.ts`

- `current_frame`, `selected_frames`, `selected_range`
- `playhead`, `fps`, `zoom`
- `onion_skin` (prev/next count 0–3 + opacity + layer toggles)
- `loop_range`

API: `seek`, `next_frame`, `previous_frame`, `select_range`, `toggle_select`, `set_onion_skin`.

The Context Engine mirrors playhead, range, and onion into `FrameLabContext` so Ask/MCP see the same selection as the canvas.

Keyframe marks are domain commands (`create_keyframe`) that change `frames.frame_type`, not engine-only flags. The engine stays UI-independent so MCP and tests share it.
