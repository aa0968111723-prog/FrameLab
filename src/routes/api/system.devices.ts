import { createFileRoute } from "@tanstack/react-router";
import { getDeviceInfo } from "@/lib/ai/registry";

export const Route = createFileRoute("/api/system/devices")({
  server: {
    handlers: {
      GET: async () => Response.json(getDeviceInfo()),
    },
  },
});
