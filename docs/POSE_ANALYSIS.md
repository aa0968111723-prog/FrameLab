# Pose Analysis

**RTMPose** is the real pose path:

`UI → analyze_pose → POSE_ANALYSIS job → workers/gpu-worker/rtmpose_worker.py → YOLOX-tiny + RTMPose-s (ONNX) → poses table → canvas skeleton`

Device is CUDA when `CUDAExecutionProvider` is present, otherwise CPU. Results are COCO-17 keypoints, stored as metadata (not images).

**pose-lite** (`provider=framelab-pose-lite`) is the basic silhouette fallback only. It is not RTMPose.
