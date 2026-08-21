# GPU

`GET /api/system/devices`

```json
{ "cpu": true, "cuda": false, "gpu": null, "vram_gb": 0, "runtime": "node" }
```

When a CUDA worker exists, DeviceManager should report the real GPU. v0.1 does not pretend a 4090 is present. TensorRT is reserved, not implemented. FP16/BF16 apply only after a PyTorch adapter is loaded.
