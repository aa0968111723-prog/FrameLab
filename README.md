# FrameLab

**AI-native frame-by-frame animation workstation.**

Give FrameLab keyframes, let it help create the inbetweens; if a frame breaks, repair only the broken frames.

FrameLab is not a NLE, not a generic video analyzer, and not an AI video website. The core is **Frame Graph + Timeline + Context Engine + Conversation + MCP**.

The studio is **visual-first**: canvas, timeline, onion skin, pose ghost, motion path, problem regions. You should see a hand jump on F105 — not a JSON score of 0.72.

V0.1 core loop: import → frames → timeline → onion skin → frame/region select → Ask overlay → Context Engine → MCP → lightweight analysis.

V0.3 Inbetween: pick two keys, get a Motion Plan (timing + spacing + constraints), generate a **candidate** with linear-blend, evaluate, regenerate only bad frames, then Accept. Wan / RIFE stay `PROVIDER_NOT_AVAILABLE`.

V0.4 Visual workspace: unified overlay renderer, virtualized timeline, pose ghost, motion trails, AI `VisualAnnotation`, region repair UX, flicker / difference compare.

## Why frame-by-frame

Animation problems are local. A contact break at F122 should not regenerate F100–F200. FrameLab treats every frame as a node with type, neighbors, characters, motion, and revisions — then lets humans and agents operate on that graph through the same commands.

## Architecture

Modular TypeScript monolith (TanStack Start + Postgres/PGLite):

- **Web UI** — animation workstation
- **REST** — `/api/v1?tool=…` and `/api/v1/projects`, `/api/v1/interpolate`, …
- **MCP** — `POST /api/mcp` (JSON-RPC, Streamable HTTP)
- All three call **application commands** (`src/lib/commands/execute.ts`)

Python FastAPI + GPU workers are deliberately not the runtime in v0.1. Adapter interfaces exist; unloaded models return `MODEL_NOT_AVAILABLE` / `PROVIDER_NOT_AVAILABLE` instead of fake scores. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

```bash
npm install
npm run dev
```

Open the app, sign in, then **Classic ball** for a 24-frame squash-and-stretch timeline.

```bash
npm test
npm run typecheck
npm run build
```

## CPU mode

Pixel metrics, linear-blend inbetweens, neighborhood repair, timeline, onion skin, revisions, MCP, FFmpeg extract, and Grok vision (API) run without a GPU.

## GPU mode

CUDA adapters (SAM 2, RIFE, Wan, Video Depth Anything) are reserved. **RTMPose**, **LocoTrack-S**, and **SEA-RAFT-S** run through Python workers on CUDA when present, otherwise CPU.

## Web UI

- Animation canvas is the visual center: pan, zoom, fit, 100%, onion skin, pose ghost, motion path, tracking trail, sampled flow, problem bubbles, AI pointers
- Timeline: virtualized thumbnails, key / breakdown / generated / repaired / hold marks, problem ranges, mask track, hover preview, playhead scrub
- Overlay switcher on the canvas (Original / Onion / Pose / Motion / Track / Mask / Problems / Compare). Shift-click to stack.
- Region drag → Ask AI / Track / Propagate ±5 / Repair here
- Flicker, side-by-side, difference, hold-to-compare
- Ask panel as overlay + orb (ASK / ASSIST). Context chips show the frame, range, region, character the model is looking at
- Modes: ANIMATE, ANALYZE, REPAIR, REVIEW, GENERATE — same workspace
- Advanced inspector still has type, duration, lock, scores, revisions, jobs — hidden behind Advanced
- Import video or image sequence (browser decoder) or **FFmpeg** server extract
- Export WebM via MediaRecorder

## MCP server

```
POST /api/mcp
Authorization: Bearer fl_…
```

Issue a token from the studio home. Tokens are stored as SHA-256 hashes. Scopes: `READ ANALYZE EDIT GENERATE RENDER ADMIN`. Tokens can be limited to one project. 120 calls/min/client.

See [docs/MCP.md](docs/MCP.md) and [docs/MCP_SECURITY.md](docs/MCP_SECURITY.md). Context docs: [docs/CONTEXT_ENGINE.md](docs/CONTEXT_ENGINE.md), [docs/CONVERSATION_LAYER.md](docs/CONVERSATION_LAYER.md), [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md), [docs/ANIMATION_WORKSPACE.md](docs/ANIMATION_WORKSPACE.md).

## Connecting external AI

1. Sign in → issue MCP token
2. Point Claude / Grok / Codex at `/api/mcp`
3. Prompt: *find unnatural motion on this timeline, then repair only the problem window*

The agent uses the same tools as the UI (`analyze_consistency`, `get_problem_frames`, `repair_frame_range`). Analyze/repair return a `jobId`.

## REST API

`GET/POST /api/v1?tool=list_projects` with session or Bearer token. Path aliases: `/api/v1/projects`, `/api/v1/interpolate`, `/api/v1/jobs/:id`. [docs/REST_API.md](docs/REST_API.md)

TypeScript client: `packages/sdk`.

## Models

| Provider | Status |
| --- | --- |
| pixel-metrics (MAE, histogram, luma flicker, 16×16 block match) | **ready** |
| linear-blend interpolation + motion curves | **ready** |
| FFmpeg frame extract | **ready** |
| xAI grok-4.5 vision (user-initiated frames only) | **ready** if `XAI_API_KEY` |
| RTMPose-s + YOLOX-tiny (Python worker) | **ready** (CUDA or CPU) |
| LocoTrack-S (Python worker) | **ready** (CUDA or CPU) |
| SEA-RAFT-S (Python worker) | **ready** (CUDA or CPU) |
| SAM 2, Depth Anything, RIFE, Wan | adapter only — `MODEL_NOT_AVAILABLE` |

No random poses. No fake depth. No hardcoded consistency.

## Testing

```bash
npm test          # domain + spec-gap unit tests
npm run lint
npm run typecheck
npm run build
```

## Licensing

Application: use as you like for this project. Model checkpoints: see [docs/MODEL_LICENSES.md](docs/MODEL_LICENSES.md). Research-only weights are never the default production provider.

## Roadmap

Phase 0–1 (this tree): foundation + real frame workflow.  
Phase 2+: one real local model at a time (adapter → inference → DB → UI → MCP → test).  
[docs/ROADMAP.md](docs/ROADMAP.md)
