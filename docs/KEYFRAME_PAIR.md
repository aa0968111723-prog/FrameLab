# Keyframe Pair

A **Keyframe Pair** is the unit of inbetweening. It is not a video clip.

```
start KEY  →  generated inbetweens  →  end KEY
```

## Validation

`create_keyframe_pair` / `validateKeyframePair`:

- start < end, integers
- both frames exist
- both have image assets
- not a locked-invalid pair

Errors: `INVALID_KEYFRAME_PAIR`, `KEYFRAME_NOT_FOUND`, `FRAME_ASSET_UNAVAILABLE`.

`frame_gap = end - start`. Default inbetween count is `gap - 1`.

## UI

Select F100 → Set Start. Select F110 → Set End. Or use the selected range.

Inspector shows Start, End, Gap, Generated count.

Pairs are stored in `keyframe_pairs` and exposed as `framelab://keyframe-pairs/{id}`.
