import { createFileRoute } from "@tanstack/react-router";
import { handleRest } from "@/lib/framelab/rest-http";

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: (ctx) => handleRest(ctx.request),
      POST: (ctx) => handleRest(ctx.request),
      DELETE: (ctx) => handleRest(ctx.request),
    },
  },
});
