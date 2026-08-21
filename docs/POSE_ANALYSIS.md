# Pose Analysis

Runnable provider: `framelab-pose-lite` — silhouette extrema from pixel mass / frame difference. Normalized keypoints (`right_wrist`, …), bbox, confidence.

`rtmpose` / `mmpose` adapters exist and return `MODEL_NOT_AVAILABLE`. No fake skeletons.

`poseContinuity` flags `POSE_VELOCITY_SPIKE` and missing joints.
