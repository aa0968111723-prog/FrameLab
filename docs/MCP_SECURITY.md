# MCP security

- Tokens: `fl_` + 48 hex bytes. Only SHA-256 is stored (`mcp_clients.token_hash`).
- Scopes: `READ`, `ANALYZE`, `EDIT`, `GENERATE`, `RENDER`, `ADMIN`.
- Project isolation: `project_scope` is `all` or a project id (comma-separated). Enforced on every `ownProject` call.
- Disabled tokens (`enabled = false`) cannot authenticate.
- Audit: `mcp_audit_logs` records tool, caller, args (binaries redacted), status, duration, error.
- High-risk tools always create a `revisions` row with before/after snapshots (image included for replace/repair/delete).
- Rate limit: 120 MCP tool calls / minute / client (`RATE_LIMITED`).
- File uploads: type via extension allow-list; names sanitized; FFmpeg invoked with `spawn` argv only — never a shell, never interpolated user strings in filters.
- MCP tokens cannot see another user's projects (`user_id` + `project_scope`).
