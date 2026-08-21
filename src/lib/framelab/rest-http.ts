import { createHash } from "node:crypto";
import { ALL_SCOPES, executeTool, type CommandContext } from "@/lib/commands/execute";
import { parseScopes } from "@/lib/domain/permissions";
import * as repo from "@/lib/framelab/repo";
import { getSessionUser } from "@/lib/auth/verify.server";
import { mapRestPath } from "./rest-map";

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

  const ctx = await restContext(request);
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
  const user = await getSessionUser();
  if (!user) return null;
  return {
    userId: user.id,
    source: "rest",
    caller: `user:${user.id}`,
    scopes: ALL_SCOPES,
  };
}
