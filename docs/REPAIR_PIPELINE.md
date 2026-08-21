# Repair Pipeline

Minimal safe repair:

1. Problem range (e.g. F134–F138)
2. Planner expands to a window, protecting KEY boundaries and locked frames
3. User confirms
4. `execute_repair_plan` interpolates **interior** frames only (`linear-blend` 快速預覽, or RIFE when loaded)
5. Marked `FULL_FRAME_INTERPOLATION` — no fake region inpaint
6. Revision stores original JPEG; restore puts it back
7. Re-run assist analysis for before/after scores

Region repair is a separate flow: **選區 → 遮罩 → 時間脈絡 → 候選 → 前後比較**. `regenerate_region` default is generative. Unconfigured Wan → `PROVIDER_NOT_AVAILABLE`. Neighborhood bbox paste is `method=preview` / 快速預覽 only.
