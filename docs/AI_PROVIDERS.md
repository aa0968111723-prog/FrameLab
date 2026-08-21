# AI Providers

FrameLab is **provider-agnostic**. Grok is one adapter.

Interface: `src/lib/ai/llm-provider.ts` (`LLMProvider` + `ProviderRegistry.list` / `.get`)

| id | Role | Status without extra keys |
| --- | --- | --- |
| `grok` | xAI `grok-4.5` chat + tools + vision | `ready` if `XAI_API_KEY` is set, else `not_configured` |
| `openai` | Reserved | `NOT_CONFIGURED` |
| `claude` | Reserved | `NOT_CONFIGURED` |
| `gemini` | Reserved | `NOT_CONFIGURED` |
| `local` | Reserved | `NOT_CONFIGURED` |

Missing keys never produce a fabricated assistant reply. ASK still returns lightweight visual analysis so “这里” is grounded.

Vision assets (`src/lib/conversation/vision-assets.ts`) downsample the current frame, a padded region crop, and at most a couple of neighbor thumbnails.

Pixel / motion / tracking models (NCC, block-match, linear-blend, RIFE) are **not** LLM providers. They live in `src/lib/ai/providers.ts`. SAM2 / Wan stay `MODEL_NOT_AVAILABLE` / `PROVIDER_NOT_AVAILABLE` until those checkpoints exist. `linear-blend` is 快速預覽 only — not AI inbetweening.
