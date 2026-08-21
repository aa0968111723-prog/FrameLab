export type McpClientOptions = {
  url: string;
  token: string;
};

type RpcResult = {
  jsonrpc?: string;
  result?: unknown;
  error?: { code: number; message: string };
};

export class FrameLabMcpClient {
  constructor(private readonly opts: McpClientOptions) {}

  private async rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
    const res = await fetch(this.opts.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = (await res.json()) as RpcResult;
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  initialize() {
    return this.rpc("initialize");
  }
  listTools() {
    return this.rpc("tools/list");
  }
  callTool(name: string, args: Record<string, unknown> = {}) {
    return this.rpc("tools/call", { name, arguments: args });
  }
  listResources() {
    return this.rpc("resources/list");
  }
  readResource(uri: string) {
    return this.rpc("resources/read", { uri });
  }
  listPrompts() {
    return this.rpc("prompts/list");
  }
}

const registry: { name: string; url: string; token?: string }[] = [];

export function registerServer(server: { name: string; url: string; token?: string }) {
  const i = registry.findIndex((s) => s.name === server.name);
  if (i >= 0) registry[i] = server;
  else registry.push(server);
}

export function listServers() {
  return [...registry];
}

export function connect(name: string) {
  const s = registry.find((x) => x.name === name);
  if (!s) throw new Error(`Unknown MCP server ${name}`);
  return new FrameLabMcpClient({ url: s.url, token: s.token || "" });
}
