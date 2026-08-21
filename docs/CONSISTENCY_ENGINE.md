# Consistency Engine v1

Fuses motion spikes, pose-lite continuity, track breaks, contact heuristics, luma flicker, character/object assignment gaps.

`analyze_consistency` runs this engine (not a second pixel-only score). Pixel MAE is merged as extra evidence; fused Motion/Pose/Tracking/Contact scores win.

Scores are real metrics with evidence (velocity_ratio, jump, distance). Severity: info / warning / error / critical.

Problem frames merge into problem ranges (gap ≤ 2). Inspector rows are clickable for evidence.
