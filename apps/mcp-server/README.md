# FrameLab MCP server

MCP is not a sidecar with its own business logic. The HTTP transport lives at
`POST /api/mcp` and calls `executeTool` — the same command layer as the Web UI
and REST API.

Transports:

- **Streamable HTTP** (primary) — `/api/mcp`
- **stdio** — `node apps/mcp-server/stdio.mjs` proxies JSON-RPC lines to HTTP

Auth: `Authorization: Bearer <token>`. Tokens are SHA-256 hashed in
`mcp_clients`. Never stored in plaintext.
