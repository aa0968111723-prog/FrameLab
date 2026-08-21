# Generation Providers

`InbetweenProvider` is separate from `InterpolationProvider`.

| id | kind | status |
| --- | --- | --- |
| `linear-blend` | interpolation | **ready** — per-pixel blend + motion curve |
| `rife` | interpolation | `PROVIDER_NOT_AVAILABLE` |
| `wan` | generative | `PROVIDER_NOT_AVAILABLE` |
| `fal.ai` | generative | `MODEL_NOT_AVAILABLE` |
| `comfyui` | generative | `PROVIDER_NOT_AVAILABLE` |

Routing is `strategy → registry → capabilities`. There is no `if inbetween: use_wan()`.

Capabilities advertised: frame pair, multi-frame, pose guidance, mask, motion guidance, seed, character reference, resolution.

If a constraint cannot be enforced (linear-blend has no mask / pose guidance), the UI warns:

> Constraint will be evaluated after generation but cannot be enforced during generation.

Production never uses a random-image or solid-color fake provider. Tests must not ship a `TEST_ONLY` generator in `getInbetween()`.
