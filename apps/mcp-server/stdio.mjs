#!/usr/bin/env node
/**
 * FrameLab MCP stdio transport.
 * Proxies JSON-RPC lines to the Streamable HTTP server at FRAMELAB_MCP_URL.
 * FrameLab itself does not need this process to start — Web / REST / HTTP MCP
 * already share executeTool. This exists so external agents that only speak
 * stdio can connect.
 *
 *   FRAMELAB_MCP_URL=http://127.0.0.1:8080/api/mcp \
 *   FRAMELAB_MCP_TOKEN=<token> \
 *   node apps/mcp-server/stdio.mjs
 */
import readline from "node:readline";

const url = process.env.FRAMELAB_MCP_URL || "http://127.0.0.1:8080/api/mcp";
const token = process.env.FRAMELAB_MCP_TOKEN || "";

async function rpc(body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let body;
  try {
    body = JSON.parse(trimmed);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } })}\n`,
    );
    return;
  }
  try {
    const result = await rpc(body);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? null,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      })}\n`,
    );
  }
});
