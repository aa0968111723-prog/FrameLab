# Candidate Versions

Generated inbetweens land in `candidate_versions`, not on the live timeline.

Flow:

1. `generate_inbetweens` (GENERATE + `confirmed=true`) → candidate + job
2. Evaluate motion / pose / tracking / contact continuity
3. Preview Original vs Candidate (empty original if the gap had no drawings)
4. `accept_generated_frames` (EDIT + confirm) → revision, then promote, Frame Graph `GENERATED_FROM` + `BETWEEN`
5. `reject_generated_frames` keeps audit metadata
6. `regenerate_inbetween_range` writes a **new** candidate; the previous one stays

Restore after a bad accept: `restore_revision` on the accept revision.

Cache key: start hash, end hash, provider, model version, seed, motion plan hash, constraint hash, resolution, frame count. Changing any of those is a miss.
