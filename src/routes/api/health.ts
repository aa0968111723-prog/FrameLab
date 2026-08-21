import { createFileRoute } from "@tanstack/react-router";
import { getDeviceInfo, listModels } from "@/lib/ai/registry";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const models = listModels();
        const ready = models.filter((m) => m.status === "ready").map((m) => m.id);
        return Response.json({
          ok: true,
          name: "FrameLab",
          version: "0.4.0",
          devices: getDeviceInfo(),
          readyProviders: ready,
        });
      },
    },
  },
});
