# MCP Context Bridge

Named module: `src/lib/mcp/context-bridge.ts`  
Tools: `src/lib/mcp/tools/context-tools.ts` (re-export of `src/lib/commands/context-tools.ts`)

MCP does not read React state. It reads the serialized `FrameLabContext` stored on `workspace_sessions`.

## ASK-safe tools

| Tool | Returns |
| --- | --- |
| `get_current_context` | `project_id`, `timeline_id`, `current_frame`, `selected_range`, `selected_frames`, `selected_region`, `selected_character`, `onion_skin`, `overlay`, `analysis_available`, `conversation_id`, `context_version` |
| `get_current_frame` | Current frame metadata (no 4K pixels) |
| `get_selected_frames` / `get_selected_frame_range` / `get_selected_range` | Selection |
| `get_selected_region` | Normalized 0–1 rectangle + `preview_asset` ref |
| `get_current_character` / `get_current_object` | Focus |
| `get_frame_neighbors` | Previous/next window as metadata + `thumbnailRef`. Session path uses onion counts when `before`/`after` omitted |
| `analyze_selection` | Lightweight visual analysis (MAE / histogram / centroid) — never pose |
| `analyze_motion_context` | 16×16 block + luma centroid across the selection |

Invalid session → `FRAME_NOT_FOUND`. Missing `sessionId` → `VALIDATION_ERROR`.

Resources:

- `framelab://sessions/{session_id}/context`
- `framelab://session/{session_id}/context` (alias)
- `framelab://conversations/{conversation_id}`

ASK conversations may only call READ + ANALYZE tools even if the token also has EDIT/GENERATE/RENDER.
