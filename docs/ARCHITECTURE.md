# Architecture

## Why this shape

The product spec described a Python FastAPI + Next.js + Redis + GPU worker split. v0.1 ships as a **TypeScript modular monolith** instead:

1. One runtime, one command layer, one database. Web, REST, and MCP cannot drift.
2. The workstation has to run where the preview/deploy lives (Node, Postgres or PGLite, no apt, no guaranteed CUDA).
3. Half a Python API that cannot start would violate the “no fake success” rule.

GPU Python workers run RTMPose, LocoTrack, SEA-RAFT, RIFE, and SAM 2 behind the existing provider interfaces (`src/lib/ai/providers.ts`) without changing commands or MCP tool names. Wan remains reserved.

V0.2 Assist path:

```
Selection → Context Engine
  → block-match motion + pose-lite + NCC tracks
  → Consistency Engine (real metrics)
  → ProblemRange + RepairPlanner
  → ASSIST suggestions (no edit)
  → user confirm → execute_repair_plan (EDIT)
  → revision + linear-blend interior frames
  → re-analyze
```


V0.3 Inbetween path:

```
Keyframe pair → transition analysis → Motion Plan (versioned)
  → strategy (interpolation | generative | suggest breakdown)
  → GENERATE_INBETWEENS job → candidate_versions (not live)
  → consistency evaluation → minimal regeneration
  → accept (revision + GENERATED_FROM / BETWEEN) or reject
```

ASSIST may `create_inbetween_plan` / `suggest_breakdown_frames`. It cannot set `confirmed=true`.


V0.4 Visual path:

```
ViewportTransform
  → OverlayRenderer (pose / ghost / trail / mask / problems / AI pointer)
VisualAnnotation (0–1 coords) ← MCP visual tools (never DOM)
Timeline virtualization (10k frames ≠ 10k DOM nodes)
RegionRepairProvider.repair_region(...)  (generative; bbox preview is not AI)
```

`ctx` carries `userId`, `source` (`ui` | `rest` | `mcp`), `caller`, `scopes`, and `projectScope`. Destructive tools always write a **revision**.

## Layout

```
src/lib/domain/     timeline engine, context engine, conversation types, graph, curves, pixel metrics, errors
src/lib/commands/   the only mutation path (including context-tools)
src/lib/conversation/  ASK runtime + vision asset builder
src/lib/framelab/   SQL repo + server functions + REST mapper
src/lib/ai/         LLM providers (Grok + reserved) + grok vision + consistency fusion
src/lib/application/ conversation-context + vision-assets (named spec entry points)
src/lib/mcp/        HTTP JSON-RPC + catalog + context-bridge + outbound client
src/lib/jobs/       job wrapper
src/lib/storage/    LocalStorage layout
src/lib/media/      ffmpeg argv (no shell)
src/lib/visual/      viewport, overlay renderer, timeline virtualization, workspace modes
src/components/workstation/
packages/sdk/       TypeScript client over /api/v1
packages/mcp-client/
packages/context-engine/  re-export of the domain context engine
```

Workspace context is a domain object (`FrameLabContext`), persisted on `workspace_sessions`, read by MCP `get_current_context`. UI, REST, and MCP still share `executeTool`.

ASK conversation path:

```
Canvas / Timeline selection
  → Context Engine (serialize + version)
  → workspace_sessions
  → Conversation Runtime (READ + ANALYZE only)
  → executeTool (get_current_context / analyze_selection / …)
  → LLMProvider (Grok if keyed, else NOT_CONFIGURED + lightweight analysis)
```

The browser never holds an MCP token. Missing providers do not fabricate replies.

Postgres relationships + an application graph (`graph_edges` + derived NEXT/PREV from `frame_number`). No Neo4j in v0.1.

## Storage

Frame JPEGs are mirrored as base64 text columns so the workstation can load without a file server. LocalStorage also writes `data/projects/{id}/{frames,generated,repaired,source,...}`. S3 returns `NOT_IMPLEMENTED`.

## Jobs

Analyze, interpolate, repair, and FFmpeg extract create `jobs` rows (`queued → running → completed|failed`). Pixel work finishes in-request but is still queryable via `get_job`. GPU adapters are not marked `completed` with fake payloads.
