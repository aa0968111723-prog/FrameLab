-- V0.2: store revision id on MCP audit logs for execute_repair_plan / restore_revision.

alter table mcp_audit_logs add column revision_id text;
