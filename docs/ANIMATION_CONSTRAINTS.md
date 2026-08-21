# Animation Constraints

Kinds:

- `PRESERVE_CHARACTER`
- `PRESERVE_FACE`
- `PRESERVE_BACKGROUND`
- `PRESERVE_CLOTHING`
- `PRESERVE_OBJECT`
- `MAINTAIN_CONTACT`
- `LOCK_REGION`
- `LOCK_KEYFRAME`
- `KEEP_CAMERA_STATIC`

## Contact

`right_hand ↔ suitcase` is a `ContactConstraint` (`source_entity`, `source_point`, `target_entity`, `target_region`, frames, strength).

Natural language:

- 脸不要动 → `PRESERVE_FACE`
- 背景不要改 → `PRESERVE_BACKGROUND`
- 右手要一直抓行李箱 → `MAINTAIN_CONTACT`

Parsed deterministically (`AnimationIntentParser`). Frame numbers still come from the Context Engine / timeline, not the LLM.
