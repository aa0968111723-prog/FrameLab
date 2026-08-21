# Development

```bash
npm install
npm run dev          # workstation
npm test
npm run lint
npm run typecheck
npm run build
```

Postgres: set `DATABASE_URL` for Neon. Unset → PGLite (preview). Do not create a `.env` in the sandbox.

Auth is real (Google / X via the Grok broker). Per-user rows filter on `user_id`.

MCP token: studio home → Issue. Call `POST /api/mcp` with `tools/list` then `tools/call`.

FFmpeg ingest: `POST /api/videos` multipart field `file`. Browser import stays available without a server round-trip.

CPU-only docker: `docker compose -f docker-compose.dev.yml up`. GPU compose is a stub for later CUDA workers.
