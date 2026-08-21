import { createHash } from "node:crypto";
import { executeTool, type CommandContext } from "@/lib/commands/execute";
import { getDeviceInfo, listModels } from "@/lib/ai/registry";
import { parseScopes } from "@/lib/domain/permissions";
import * as repo from "@/lib/framelab/repo";
import { MCP_PROMPTS, MCP_RESOURCE_TEMPLATES, MCP_RESOURCES, MCP_TOOLS, promptText } from "./catalog.ts";

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export async function handleMcpRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/api/mcp")) {
    return json({
      name: "FrameLab MCP",
      version: "0.4.0",
      protocol: "2024-11-05",
      transports: ["streamable-http"],
      resources: MCP_RESOURCES.length,
      tools: MCP_TOOLS.length,
      prompts: MCP_PROMPTS.length,
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = await authorize(request);
  if (!auth.ok) {
    return json({ error: auth.error, code: auth.code }, auth.status);
  }

  let body: Rpc;
  try {
    body = (await request.json()) as Rpc;
  } catch {
    return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }, 400);
  }

  const id = body.id ?? null;
  const method = body.method ?? "";
  const params = body.params ?? {};

  try {
    const result = await dispatch(auth.ctx, method, params);
    return json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ jsonrpc: "2.0", id, error: { code: -32000, message } }, 200);
  }
}

async function authorize(request: Request): Promise<
  | { ok: true; ctx: CommandContext }
  | { ok: false; error: string; code: string; status: number }
> {
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) {
    return {
      ok: false,
      error: "Missing Bearer token",
      code: "UNAUTHORIZED",
      status: 401,
    };
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const client = await repo.getMcpClientByHash(hash);
  if (!client) {
    return {
      ok: false,
      error: "Invalid MCP token",
      code: "UNAUTHORIZED",
      status: 401,
    };
  }
  return {
    ok: true,
    ctx: {
      userId: client.user_id,
      source: "mcp",
      caller: `mcp:${client.name}`,
      scopes: parseScopes(client.scopes),
      clientId: client.id,
      projectScope: client.project_scope,
    },
  };
}

async function dispatch(
  ctx: CommandContext,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "FrameLab", version: "0.4.0" },
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
      };
    case "notifications/initialized":
      return {};
    case "ping":
      return {};
    case "tools/list":
      return { tools: MCP_TOOLS };
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments as Record<string, unknown>) ?? {};
      const result = await executeTool(ctx, name, args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.ok === false,
      };
    }
    case "resources/list":
      return { resources: MCP_RESOURCES, resourceTemplates: MCP_RESOURCE_TEMPLATES };
    case "resources/read":
      return readResource(ctx, String(params.uri ?? ""));
    case "prompts/list":
      return { prompts: MCP_PROMPTS };
    case "prompts/get": {
      const name = String(params.name ?? "");
      const args = (params.arguments as Record<string, string>) ?? {};
      return {
        description: MCP_PROMPTS.find((p) => p.name === name)?.description ?? "",
        messages: [
          {
            role: "user",
            content: { type: "text", text: promptText(name, args) },
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown method ${method}`);
  }
}

async function readResource(ctx: CommandContext, uri: string) {
  if (uri === "framelab://projects") {
    const data = await executeTool(ctx, "list_projects", {});
    return textResource(uri, data);
  }
  if (uri === "framelab://models") {
    return textResource(uri, { models: listModels() });
  }
  if (uri === "framelab://system/status") {
    return textResource(uri, { devices: getDeviceInfo(), models: listModels() });
  }
  const project = /^framelab:\/\/projects\/([^/]+)$/.exec(uri);
  if (project) {
    return textResource(uri, await executeTool(ctx, "get_project", { projectId: project[1] }));
  }
  const timeline = /^framelab:\/\/timelines\/([^/]+)$/.exec(uri);
  if (timeline) {
    return textResource(uri, await executeTool(ctx, "get_timeline", { timelineId: timeline[1] }));
  }
  const frame = /^framelab:\/\/frames\/([^/]+)$/.exec(uri);
  if (frame) {
    return textResource(uri, await executeTool(ctx, "get_frame", { frameId: frame[1] }));
  }
  const analysis = /^framelab:\/\/frames\/([^/]+)\/analysis$/.exec(uri);
  if (analysis) {
    return textResource(uri, await executeTool(ctx, "get_frame_analysis", { frameId: analysis[1] }));
  }
  const neighbors = /^framelab:\/\/frames\/([^/]+)\/neighbors$/.exec(uri);
  if (neighbors) {
    return textResource(uri, await executeTool(ctx, "get_frame_neighbors", { frameId: neighbors[1] }));
  }
  const job = /^framelab:\/\/jobs\/([^/]+)$/.exec(uri);
  if (job) {
    return textResource(uri, await executeTool(ctx, "get_job", { jobId: job[1] }));
  }
  const video = /^framelab:\/\/videos\/([^/]+)$/.exec(uri);
  if (video) {
    return textResource(uri, await executeTool(ctx, "get_video", { videoId: video[1] }));
  }
  const character = /^framelab:\/\/characters\/([^/]+)$/.exec(uri);
  if (character) {
    return textResource(uri, await executeTool(ctx, "get_character", { characterId: character[1] }));
  }
  const characterTrack = /^framelab:\/\/characters\/([^/]+)\/track$/.exec(uri);
  if (characterTrack) {
    return textResource(
      uri,
      await executeTool(ctx, "get_character_track", { characterId: characterTrack[1] }),
    );
  }
  const object = /^framelab:\/\/objects\/([^/]+)$/.exec(uri);
  if (object) {
    return textResource(uri, await executeTool(ctx, "get_object", { objectId: object[1] }));
  }
  const objectTrack = /^framelab:\/\/objects\/([^/]+)\/track$/.exec(uri);
  if (objectTrack) {
    return textResource(
      uri,
      await executeTool(ctx, "get_object_track", { objectId: objectTrack[1] }),
    );
  }
  const sessionCtx = /^framelab:\/\/sessions\/([^/]+)\/context$/.exec(uri);
  if (sessionCtx) {
    return textResource(uri, await executeTool(ctx, "get_current_context", { sessionId: sessionCtx[1] }));
  }
  const sessionCtxAlias = /^framelab:\/\/session\/([^/]+)\/context$/.exec(uri);
  if (sessionCtxAlias) {
    return textResource(uri, await executeTool(ctx, "get_current_context", { sessionId: sessionCtxAlias[1] }));
  }
  const conversation = /^framelab:\/\/conversations\/([^/]+)$/.exec(uri);
  if (conversation) {
    const { readConversationResource } = await import("@/lib/commands/context-tools");
    return textResource(uri, await readConversationResource(ctx, conversation[1]));
  }
  const pair = /^framelab:\/\/keyframe-pairs\/([^/]+)$/.exec(uri);
  if (pair) {
    return textResource(uri, await executeTool(ctx, "get_keyframe_pair", { pairId: pair[1] }));
  }
  const plan = /^framelab:\/\/motion-plans\/([^/]+)$/.exec(uri);
  if (plan) {
    return textResource(uri, await executeTool(ctx, "get_motion_plan", { planId: plan[1] }));
  }
  const genJob = /^framelab:\/\/generation-jobs\/([^/]+)$/.exec(uri);
  if (genJob) {
    return textResource(uri, await executeTool(ctx, "get_generation_job", { jobId: genJob[1] }));
  }
  const cand = /^framelab:\/\/candidates\/([^/]+)$/.exec(uri);
  if (cand) {
    return textResource(uri, await executeTool(ctx, "get_candidate", { candidateId: cand[1] }));
  }
  const genFrame = /^framelab:\/\/generated-frames\/([^/]+)$/.exec(uri);
  if (genFrame) {
    return textResource(uri, await executeTool(ctx, "get_generated_frame", { id: genFrame[1] }));
  }
  throw new Error(`Unknown resource ${uri}`);
}

function textResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
