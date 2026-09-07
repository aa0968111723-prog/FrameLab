import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleMcpRequest, MCP_PROTOCOL_VERSION, mcpStructuredContent } from "../src/lib/mcp/http.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";
import { closeTestDb, createTestDb, resetDb } from "./helpers/db.ts";

const BOOTSTRAP = "hermes-console-bootstrap-token-for-contract";
const PREV = process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN;
const PREV_USER = process.env.FRAMELAB_MCP_USER_ID;

function rpc(method: string, params: Record<string, unknown> = {}, id: number | null = 1) {
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (id !== null) body.id = id;
  return new Request("http://framelab.local/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${BOOTSTRAP}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(body),
  });
}

describe("FrameLab MCP ↔ Hermes Console contract", () => {
  before(() => {
    process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN = BOOTSTRAP;
    process.env.FRAMELAB_MCP_USER_ID = "hermes-console";
  });
  after(() => {
    if (PREV === undefined) delete process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN;
    else process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN = PREV;
    if (PREV_USER === undefined) delete process.env.FRAMELAB_MCP_USER_ID;
    else process.env.FRAMELAB_MCP_USER_ID = PREV_USER;
  });

  it("GET discovery names Hermes env keys and protocol 2025-06-18", async () => {
    const res = await handleMcpRequest(new Request("http://framelab.local/api/mcp"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      protocol: string;
      transports: string[];
      hermes: {
        id: string;
        envUrl: string;
        envToken: string;
        runtimePrefix: string;
        workspacePrefix: string;
      };
      tools: number;
    };
    assert.equal(body.protocol, "2025-06-18");
    assert.ok(body.transports.includes("streamable-http"));
    assert.equal(body.hermes.id, "framelab");
    assert.equal(body.hermes.envUrl, "FRAMELAB_MCP_URL");
    assert.equal(body.hermes.envToken, "FRAMELAB_MCP_TOKEN");
    assert.equal(body.hermes.runtimePrefix, "mcp.framelab");
    assert.equal(body.hermes.workspacePrefix, "framelab_");
    assert.equal(body.tools, MCP_TOOLS.length);
  });

  it("OPTIONS is allowed for Streamable HTTP preflight", async () => {
    const res = await handleMcpRequest(
      new Request("http://framelab.local/api/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://console.example", "access-control-request-headers": "authorization" },
      }),
    );
    assert.equal(res.status, 204);
    assert.match(res.headers.get("allow") || "", /POST/);
  });

  it("GET text/event-stream returns 405 so official SDK skips optional SSE", async () => {
    const res = await handleMcpRequest(
      new Request("http://framelab.local/api/mcp", {
        method: "GET",
        headers: { accept: "text/event-stream", "mcp-session-id": "sess-hermes" },
      }),
    );
    assert.equal(res.status, 405);
  });

  it("DELETE closes the Streamable HTTP session", async () => {
    const res = await handleMcpRequest(
      new Request("http://framelab.local/api/mcp", { method: "DELETE" }),
    );
    assert.equal(res.status, 204);
  });

  it("rejects missing and wrong Bearer tokens", async () => {
    const missing = await handleMcpRequest(
      new Request("http://framelab.local/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    assert.equal(missing.status, 401);
    const wrong = await handleMcpRequest(
      new Request("http://framelab.local/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer not-the-bootstrap", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
    );
    assert.equal(wrong.status, 401);
  });

  it("initialize + ping + notifications match official SDK / Hermes", async () => {
    const init = await handleMcpRequest(
      rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "hermes-console-discovery", version: "2" },
      }),
    );
    assert.equal(init.status, 200);
    assert.equal(init.headers.get("mcp-protocol-version"), MCP_PROTOCOL_VERSION);
    assert.ok(init.headers.get("mcp-session-id"));
    const body = (await init.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string }; instructions: string };
    };
    assert.equal(body.result.protocolVersion, "2025-03-26");
    assert.equal(body.result.serverInfo.name, "FrameLab");
    assert.match(body.result.instructions, /mcp\.framelab/);

    const notify = await handleMcpRequest(rpc("notifications/initialized", {}, null));
    assert.equal(notify.status, 202);
    assert.ok(notify.headers.get("mcp-session-id"));

    const ping = await handleMcpRequest(rpc("ping"));
    assert.equal(ping.status, 200);
    const pong = (await ping.json()) as { result: Record<string, unknown> };
    assert.deepEqual(pong.result, {});
  });

  it("tools/list annotates read vs write for Hermes permission mapping", async () => {
    const res = await handleMcpRequest(rpc("tools/list"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      result: {
        tools: Array<{
          name: string;
          annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
        }>;
      };
    };
    const tools = body.result.tools;
    assert.ok(tools.length >= 80);
    const list = tools.find((t) => t.name === "list_projects");
    const del = tools.find((t) => t.name === "delete_frame");
    const gen = tools.find((t) => t.name === "generate_inbetweens");
    const create = tools.find((t) => t.name === "create_project");
    assert.equal(list?.annotations?.readOnlyHint, true);
    assert.equal(list?.annotations?.destructiveHint, false);
    assert.equal(del?.annotations?.readOnlyHint, false);
    assert.equal(del?.annotations?.destructiveHint, true);
    assert.equal(gen?.annotations?.readOnlyHint, false);
    assert.equal(gen?.annotations?.destructiveHint, true);
    assert.equal(create?.annotations?.readOnlyHint, false);
    assert.equal(create?.annotations?.destructiveHint, false);
  });

  it("mcpStructuredContent flattens executeTool {ok,data} the way Hermes reads it", () => {
    const listed = mcpStructuredContent("list_projects", {
      ok: true,
      data: [{ id: "prj_1", name: "馬桶超人" }],
    });
    assert.equal(listed.ok, true);
    assert.equal((listed.projects as Array<{ id: string }>)[0]?.id, "prj_1");
    assert.equal("data" in listed, false);

    const created = mcpStructuredContent("create_project", {
      ok: true,
      data: { id: "prj_2", timelineId: "tl_2", name: "空白", projectId: "prj_2" },
    });
    assert.equal(created.id, "prj_2");
    assert.equal(created.timelineId, "tl_2");

    const failed = mcpStructuredContent("get_project", {
      ok: false,
      code: "PROJECT_NOT_FOUND",
      error: "missing",
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "PROJECT_NOT_FOUND");
  });
});

describe("Hermes invokeFramelab live tools/call", { concurrency: false, timeout: 60_000 }, () => {
  before(async () => {
    process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN = BOOTSTRAP;
    process.env.FRAMELAB_MCP_USER_ID = "hermes-console";
    await createTestDb();
    await resetDb();
  });
  after(async () => {
    await closeTestDb();
    if (PREV === undefined) delete process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN;
    else process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN = PREV;
    if (PREV_USER === undefined) delete process.env.FRAMELAB_MCP_USER_ID;
    else process.env.FRAMELAB_MCP_USER_ID = PREV_USER;
  });

  it("create_project then list_projects returns top-level projects[] (not nested data)", async () => {
    const createdRes = await handleMcpRequest(
      rpc("tools/call", {
        name: "create_project",
        arguments: { name: "馬桶超人", fps: 24 },
      }),
    );
    assert.equal(createdRes.status, 200);
    const createdBody = (await createdRes.json()) as {
      result: {
        isError?: boolean;
        structuredContent?: { ok?: boolean; id?: string; timelineId?: string; name?: string };
      };
    };
    assert.equal(createdBody.result.isError, false);
    const created = createdBody.result.structuredContent;
    assert.equal(created?.ok, true);
    assert.ok(created?.id);
    assert.ok(created?.timelineId);
    assert.equal(created?.name, "馬桶超人");
    assert.equal("data" in (created || {}), false);

    const listedRes = await handleMcpRequest(rpc("tools/call", { name: "list_projects", arguments: {} }, 2));
    assert.equal(listedRes.status, 200);
    const listedBody = (await listedRes.json()) as {
      result: {
        isError?: boolean;
        structuredContent?: { ok?: boolean; projects?: Array<{ id: string; name: string }>; data?: unknown };
      };
    };
    assert.equal(listedBody.result.isError, false);
    const listed = listedBody.result.structuredContent;
    assert.equal(listed?.ok, true);
    assert.ok(Array.isArray(listed?.projects), "Hermes reads result.projects, not result.data");
    assert.equal(listed?.data, undefined);
    assert.ok(listed?.projects?.some((p) => p.id === created?.id && p.name === "馬桶超人"));
  });

  it("get_timeline + get_frame_window match Hermes workspace wrappers", async () => {
    const sampleRes = await handleMcpRequest(
      rpc("tools/call", { name: "create_sample_project", arguments: { name: "經典彈跳球" } }, 3),
    );
    const sample = ((await sampleRes.json()) as {
      result: { structuredContent?: { timelineId?: string; id?: string } };
    }).result.structuredContent;
    assert.ok(sample?.timelineId, JSON.stringify(sample));

    const tlRes = await handleMcpRequest(
      rpc("tools/call", { name: "get_timeline", arguments: { timelineId: sample.timelineId } }, 4),
    );
    const tl = ((await tlRes.json()) as {
      result: { isError?: boolean; structuredContent?: { id?: string; frames?: unknown[] } };
    }).result;
    assert.equal(tl.isError, false);
    assert.equal(tl.structuredContent?.id, sample.timelineId);
    assert.ok(Array.isArray(tl.structuredContent?.frames));
    assert.ok((tl.structuredContent?.frames?.length || 0) >= 24);

    const winRes = await handleMcpRequest(
      rpc(
        "tools/call",
        { name: "get_frame_window", arguments: { timelineId: sample.timelineId, centerFrame: 8, before: 1, after: 1 } },
        5,
      ),
    );
    const win = ((await winRes.json()) as {
      result: { isError?: boolean; structuredContent?: { ok?: boolean; frames?: Array<{ frame_number: number }> } };
    }).result;
    assert.equal(win.isError, false);
    assert.ok(Array.isArray(win.structuredContent?.frames));
    const numbers = (win.structuredContent?.frames || []).map((f) => f.frame_number).sort((a, b) => a - b);
    assert.deepEqual(numbers, [7, 8, 9]);
  });
});
