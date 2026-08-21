# GPU worker — RTMPose

Python process used by FrameLab for **real** RTMPose inference.

```
UI  →  analyze_pose  →  POSE_ANALYSIS job  →  rtmpose_worker.py  →  YOLOX-tiny + RTMPose-s (ONNX)
     →  poses table  →  canvas skeleton overlay
```

`pose-lite` remains a CPU silhouette fallback (`provider=framelab-pose-lite`). It is not RTMPose.

## Run

```bash
pip install -r workers/gpu-worker/requirements.txt
python3 workers/gpu-worker/rtmpose_worker.py --health
```

The Node API spawns this script per pose job (model stays loaded for the batch). CUDA is used when `CUDAExecutionProvider` is present; otherwise CPU.

First run downloads YOLOX-tiny + RTMPose-s ONNX from OpenMMLab into `~/.cache/rtmlib`.
