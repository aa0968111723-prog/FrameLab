# SAM 2

Click a character or object. SAM 2.1 returns a **real mask**, then propagates it forward and backward.

```
Canvas click → segment_object → SEGMENTATION job → sam2_worker.py → SAM 2.1 hiera-tiny → masks → Canvas overlay
```

Clicks are pixels. The worker passes them to `SAM2VideoPredictor.add_new_points_or_box(..., normalize_coords=True)`.

Switch the overlay to **遮罩**, then click. Direction chips: 向後 / 雙向 / 向前.

## Confidence

| status | meaning |
| --- | --- |
| `ok` | score ≥ 0.55 and area stable |
| `warn` | 0.35–0.55, or a sudden area jump |
| `lost` | score < 0.35, empty mask, or the mask paints ≥ 92% of the frame |

`warn` / `lost` frames are labelled on the canvas. The job is **not** toasted as success. An empty seed mask fails the job (`Not a success`) instead of writing a stub.

Rectangle `propagateMask` is **not** SAM 2.

```bash
python3 workers/gpu-worker/sam2_worker.py --health
```
