# Animation pipeline

```
source (video | image sequence | generated sample)
  → FFmpeg or browser decoder
  → frames (JPEG + thumb + hash + LocalStorage mirror)
  → timeline + Frame Graph (NEXT/PREV, APPEARS_IN)
  → keys / breakdowns / inbetweens / holds
  → generate_inbetweens (count, curve) via linear-blend
  → pixel consistency + optional tracking-point CONTACT_BREAK
  → neighborhood blend repair (range)
  → revision (restore)
  → export (browser MediaRecorder WebM)
```

Analysis levels:

| Level | What runs |
| --- | --- |
| 0 | metadata |
| 1 | histogram, MAE vs previous, luma |
| 2 | 16×16 block matching |
| 3 | + Grok vision on **this frame only** |

Smart sampling picks keys, endpoints, histogram/flow spikes. Never run VLM on every frame.

Jobs: `VIDEO_INGEST`, `FRAME_EXTRACTION`, `CONSISTENCY_ANALYSIS`, `INTERPOLATION`, `GENERATIVE_REPAIR`, … query via `get_job`.
