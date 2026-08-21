import { createFileRoute } from "@tanstack/react-router";
import { getDeviceInfo, listModels } from "@/lib/ai/registry";

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ models: listModels(), devices: getDeviceInfo() }),
    },
  },
});
