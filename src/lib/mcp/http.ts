import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { executeTool, type CommandContext } from "@/lib/commands/execute";
import { isHighRisk, parseScopes, TOOL_SCOPES, type Scope } from "@/lib/domain/permissions";
import * as repo from "@/lib/framelab/repo";
import { MCP_PROMPTS, MCP_RESOURCE_TEMPLATES, MCP_RESOURCES, MCP_TOOLS, promptText } from "./catalog.ts";

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

/** Hermes Console + official MCP SDK speak 2025-03-26 / 2025-06-18. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

const HERMES_SCOPES: Scope[] = [
  "READ",
  "ANALYZE",
  "SUGGEST",
  "EDIT",
  "GENERATE",
  "RENDER",
];

const CORS_ALLOW_HEADERS =
  "authorization, content-type, accept, mcp-protocol-version, mcp-session-id";
const CORS_ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";

function corsHeaders(request: Request, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    ...extra,
  };
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: CORS_ALLOW_METHODS,
        ...corsHeaders(request),
      },
    });
  }

  if (request.method === "DELETE" && url.pathname.endsWith("/api/mcp")) {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, {
        "mcp-session-id": request.headers.get("mcp-session-id") || "",
      }),
    });
  }

  if (request.method === "GET" && url.pathname.endsWith("/api/mcp")) {
    const accept = request.headers.get("accept") || "";
    // Official SDK GET is Accept: text/event-stream only. We do not push
    // server-initiated messages, so 405 tells StreamableHTTPClientTransport
    // to skip the optional SSE stream instead of parsing discovery JSON.
    if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
      return new Response(null, {
        status: 405,
        headers: corsHeaders(request, { Allow: "POST, GET, DELETE, OPTIONS" }),
      });
    }
    return json(
      {
        name: "FrameLab MCP",
        version: "0.4.0",
        protocol: MCP_PROTOCOL_VERSION,
        transports: ["streamable-http"],
        resources: MCP_RESOURCES.length,
        tools: MCP_TOOLS.length,
        prompts: MCP_PROMPTS.length,
        hermes: {
          id: "framelab",
          envUrl: "FRAMELAB_MCP_URL",
          envToken: "FRAMELAB_MCP_TOKEN",
          runtimePrefix: "mcp.framelab",
          workspacePrefix: "framelab_",
          repo: "https://github.com/aa0968111723-prog/hermes-console",
        },
      },
      200,
      corsHeaders(request),
    );
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders(request, { Allow: CORS_ALLOW_METHODS }));
  }

  const auth = await authorize(request);
  if (!auth.ok) {
    return json({ error: auth.error, code: auth.code }, auth.status, corsHeaders(request));
  }

  let body: Rpc;
  try {
    body = (await request.json()) as Rpc;
  } catch {
    return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }, 400, corsHeaders(request));
  }

  if (body.id === undefined || body.id === null) {
    const session = request.headers.get("mcp-session-id") || randomUUID();
    return new Response(null, {
      status: 202,
      headers: corsHeaders(request, { "mcp-session-id": session }),
    });
  }

  const id = body.id;
  const method = body.method ?? "";
  const params = body.params ?? {};
  const session = request.headers.get("mcp-session-id") || randomUUID();

  try {
    const result = await dispatch(auth.ctx, method, params);
    const headers = corsHeaders(request, {
      "content-type": "application/json; charset=utf-8",
      "mcp-session-id": session,
    });
    if (method === "initialize") {
      headers["mcp-protocol-version"] = MCP_PROTOCOL_VERSION;
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ jsonrpc: "2.0", id, error: { code: -32000, message } }, 200, corsHeaders(request, { "mcp-session-id": session }));
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

  const bootstrap = (process.env.FRAMELAB_MCP_BOOTSTRAP_TOKEN || "").trim();
  if (bootstrap && secretEqual(token, bootstrap)) {
    return {
      ok: true,
      ctx: {
        userId: (process.env.FRAMELAB_MCP_USER_ID || "hermes-console").trim(),
        source: "mcp",
        caller: "mcp:hermes-console",
        scopes: HERMES_SCOPES,
        clientId: "mcp-hermes-bootstrap",
        projectScope: "all",
      },
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

function secretEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function annotationsFor(name: string) {
  const scope = TOOL_SCOPES[name];
  return {
    readOnlyHint: scope === "READ" || scope === "ANALYZE",
    destructiveHint: isHighRisk(name),
    idempotentHint: scope === "READ",
    openWorldHint: false,
  };
}

/**
 * Hermes Console reads structuredContent at the top level
 * (`result.projects`, not `result.data.projects`). executeTool wraps
 * command output as `{ ok, data }`; flatten that so workspace
 * `framelab_*` tools and Runtime `mcp.framelab.*` see the same shape.
 */
export function mcpStructuredContent(
  name: string,
  result: { ok: true; data: unknown } | { ok: false; code: string; error: string },
): Record<string, unknown> {
  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error };
  }
  const data = result.data;
  if (Array.isArray(data)) {
    return { ok: true, [arrayKeyFor(name)]: data };
  }
  if (data && typeof data === "object") {
    return { ok: true, ...(data as Record<string, unknown>) };
  }
  return { ok: true, value: data };
}

function arrayKeyFor(name: string): string {
  if (name === "list_projects") return "projects";
  if (name === "list_videos") return "videos";
  if (name === "list_jobs") return "jobs";
  if (name === "list_revisions") return "revisions";
  if (name === "list_characters") return "characters";
  if (name === "list_objects") return "objects";
  if (name === "list_candidates") return "candidates";
  if (name === "list_segmentations") return "segmentations";
  if (name === "list_visual_annotations") return "annotations";
  if (
    name === "get_frame_window" ||
    name === "get_frame_range" ||
    name === "get_keyframes" ||
    name === "get_problem_frames"
  ) {
    return "frames";
  }
  if (name.startsWith("list_")) return name.slice("list_".length);
  return "items";
}

async function dispatch(
  ctx: CommandContext,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested = String(
        (params.protocolVersion as string | undefined) || MCP_PROTOCOL_VERSION,
      );
      return {
        protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : MCP_PROTOCOL_VERSION,
        serverInfo: { name: "FrameLab", version: "0.4.0", websiteUrl: "https://github.com/aa0968111723-prog/FrameLab" },
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
          prompts: { listChanged: false },
        },
        instructions:
          "FrameLab animation studio for Hermes Console. Tools appear as mcp.framelab.<name> after probe, and as framelab_* on the workspace MCP. Prefer list_projects → get_timeline → get_frame_window. Destructive edits need confirmed=true. GitHub repo URLs are not MCP endpoints.",
      };
    }
    case "notifications/initialized":
      return {};
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: MCP_TOOLS.map((t) => ({
          ...t,
          annotations: annotationsFor(t.name),
        })),
      };
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments as Record<string, unknown>) ?? {};
      const result = await executeTool(ctx, name, args);
      const payload = mcpStructuredContent(name, result);
      return {
        content: [
          {
            type: "text",
            // Three-face contract (REST / executeTool / MCP) reads this wire
            // shape: { ok, data } | { ok: false, code, error }.
            text: JSON.stringify(result, null, 2),
          },
        ],
        // Hermes Console invokeFramelab reads structuredContent at the top
        // level (`projects`, `id`, `timelineId`) — never `data.projects`.
        structuredContent: payload,
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
    return textResource(uri, mcpStructuredContent("list_projects", data));
  }
  if (uri === "framelab://models") {
    return textResource(uri, await executeTool(ctx, "get_model_status", {}));
  }
  if (uri === "framelab://system/status") {
    return textResource(uri, await executeTool(ctx, "get_model_status", {}));
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
    return textResource(uri, await executeTool(ctx, "get_conversation", { conversationId: conversation[1] }));
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

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}
