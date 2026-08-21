import { createHash } from "node:crypto";
import { ALL_SCOPES, executeTool, type CommandContext } from "@/lib/commands/execute";
import { parseScopes, TOOL_SCOPES } from "@/lib/domain/permissions";
import * as repo from "@/lib/framelab/repo";
import { getSessionUser } from "@/lib/auth/verify.server";
import { mapRestPath } from "./rest-map.ts";

export async function handleRest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  let tool = url.searchParams.get("tool");
  let args: Record<string, unknown> = {};

  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        args = (await request.json()) as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
  } else {
    url.searchParams.forEach((v, k) => {
      if (k === "tool") return;
      const n = Number(v);
      args[k] =
        Number.isFinite(n) && v.trim() !== "" && !Number.isNaN(n) && v === String(n) ? n : v;
    });
  }

  if (!tool) {
    const mapped = mapRestPath(request.method, url.pathname, query);
    if (mapped) {
      tool = mapped.tool;
      args = { ...mapped.args, ...args };
    }
  }

  if (!tool) {
    return Response.json(
      {
        name: "FrameLab REST",
        usage: "GET/POST /api/v1?tool=list_projects or /api/v1/projects",
        auth: "session cookie or Bearer MCP token",
      },
      { status: 200 },
    );
  }

  // /api/v1 accepts the session cookie, so a state-changing tool reachable over
  // GET is a cross-site write primitive: an <img> tag or a sibling page's
  // top-level navigation carries the cookie and needs no CSRF token. The path
  // router already only maps mutations to POST -- it was the ?tool= escape
  // hatch that let any tool run on any method. All 42 mapped GET routes resolve
  // to READ-scope tools, so requiring that of every GET breaks no endpoint.
  const method = request.method.toUpperCase();
  if ((method === "GET" || method === "HEAD") && TOOL_SCOPES[tool] !== "READ") {
    return Response.json(
      {
        ok: false,
        code: "PERMISSION_DENIED",
        error: `${tool} changes state and cannot be invoked with ${method}; use POST`,
      },
      { status: 405, headers: { allow: "POST" } },
    );
  }

  let ctx: CommandContext | null;
  try {
    ctx = await restContext(request);
  } catch (err) {
    // Scripted sibling-origin request carrying this app's cookie.
    if (err && typeof err === "object" && "status" in err && err.status === 403) {
      return Response.json({ ok: false, code: "PERMISSION_DENIED", error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
  if (!ctx) {
    return Response.json({ code: "UNAUTHORIZED", error: "Unauthorized" }, { status: 401 });
  }
  const result = await executeTool(ctx, tool, args);
  const status = result.ok
    ? 200
    : result.code === "UNAUTHORIZED"
      ? 401
      : result.code === "RATE_LIMITED"
        ? 429
        : result.code === "PERMISSION_DENIED"
          ? 403
          : result.code === "FRAME_NOT_FOUND" || result.code === "PROJECT_NOT_FOUND"
            ? 404
            : 400;
  return Response.json(result, { status });
}

export async function restContext(request: Request): Promise<CommandContext | null> {
  const header = request.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer fl_")) {
    const token = header.slice(7).trim();
    const hash = createHash("sha256").update(token).digest("hex");
    const client = await repo.getMcpClientByHash(hash);
    if (!client) return null;
    return {
      userId: client.user_id,
      source: "rest",
      caller: `rest:${client.name}`,
      scopes: parseScopes(client.scopes),
      clientId: client.id,
      projectScope: client.project_scope,
    };
  }
  // Bearer (MCP) clients are server-to-server and legitimately cross-origin, but
  // cookie auth here must clear the same bar as the server functions: apps on
  // *.grok.me are same-site to each other and mutually untrusted, and a
  // SameSite=Lax cookie rides a sibling's scripted request. authMiddleware
  // enforces this for server functions; REST used to skip it entirely.
  const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
  assertSameSiteRequest();
  const user = await getSessionUser();
  if (!user) return null;
  return {
    userId: user.id,
    source: "rest",
    caller: `user:${user.id}`,
    scopes: ALL_SCOPES,
  };
}
