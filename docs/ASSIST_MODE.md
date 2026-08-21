# Assist Mode

ASK remains read+analyze. ASSIST adds SUGGEST (`suggest_repair`, `create_repair_plan`) but **cannot** call `execute_repair_plan`.

The UI must confirm. Then the application layer sends `confirmed=true` with EDIT scope. MCP/REST without that flag is rejected. Interpolation repair writes a new JPEG under `originals/` + `repaired/`, points `active_asset` at the new file, and keeps `original_asset`. Restore puts the snapshot back; Accept marks the revision accepted.

Conversation panel: Switch to ASSIST → ask about the current range → structured problem list (category + severity) + suggested actions.

Keyboard: `C` runs consistency/assist on the selection. `Shift+A` analyzes the current selection. `A` still opens the Ask panel (V0.1 shortcut).

Motion / Pose / Tracking / Consistency overlays toggle independently. Mask/Depth stay `MODEL_NOT_AVAILABLE`.

Repair is **FULL_FRAME_INTERPOLATION** via `linear-blend` (快速預覽). Inbetween generation uses **RIFE**.
