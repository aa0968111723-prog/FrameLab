# Motion Analysis

Provider: `block-match-16` (real 16×16 SAD). `sea-raft` stays `MODEL_NOT_AVAILABLE`.

`analyze_motion` / `analyzeMotionSequence` compare consecutive frames (or a selected region crop). Summaries stored in `motion_data`; sampled grids go to `data/projects/{id}/flow/*.json`, not the DB.

Output: mean/median magnitude, dominant direction, velocity ratio, direction change. Spikes when ratio ≥ 2× or direction jumps ≥ 55°.
