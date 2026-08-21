# Repair Pipeline

Minimal safe repair:

1. Problem range (e.g. F134–F138)
2. Planner expands to a window, protecting KEY boundaries and locked frames
3. User confirms
4. `execute_repair_plan` interpolates **interior** frames only (`linear-blend`; RIFE unavailable)
5. Marked `FULL_FRAME_INTERPOLATION` — no fake region inpaint
6. Revision stores original JPEG; restore puts it back
7. Re-run assist analysis for before/after scores
