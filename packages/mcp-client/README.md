Outbound MCP client. FrameLab starts without any external MCP server.

```ts
import { FrameLabMcpClient, registerServer, connect } from "./src/index.ts";

registerServer({ name: "framelab", url: "http://localhost:8080/api/mcp", token: "fl_…" });
const client = connect("framelab");
await client.initialize();
await client.listTools();
await client.callTool("list_projects");
await client.listResources();
```
