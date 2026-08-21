import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "@/lib/mcp/http";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
    },
  },
});
