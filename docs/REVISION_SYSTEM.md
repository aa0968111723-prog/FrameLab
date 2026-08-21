# Revision System

Every repair writes `revisions` + `revision_frames` with the previous JPEG. Original files go to `data/projects/{id}/originals/`; the new JPEG is `repaired/`. The live frame row keeps `original_asset` (never overwritten after first repair) and `active_asset` (current version). Display still uses `image_data` as the active JPEG cache.

`restore_revision` requires `confirmed=true` (same handshake as execute). It puts the snapshot back. `compare_before_after` returns original vs current images, including a frame list so a multi-frame repair can be scrubbed.

Statuses: open / executed / accepted / reverted (planner row on `repair_plans`).
