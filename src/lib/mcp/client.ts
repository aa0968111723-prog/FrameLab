/**
 * Lightweight MCP client registry. FrameLab does not depend on an external
 * MCP server to start. Implementation: packages/mcp-client.
 */

export {
  FrameLabMcpClient,
  registerServer as registerExternalServer,
  listServers as listExternalServers,
  connect,
} from "../../../packages/mcp-client/src/index.ts";
