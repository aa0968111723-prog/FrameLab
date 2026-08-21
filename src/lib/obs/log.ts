/** Structured logs for jobs / MCP. No OpenTelemetry in v0.1. */
export function logEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  const row: Record<string, unknown> = { ts: new Date().toISOString(), event };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) row[k] = v;
  }
  console.info(JSON.stringify(row));
}
