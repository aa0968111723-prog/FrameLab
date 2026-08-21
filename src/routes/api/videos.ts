import { createFileRoute } from "@tanstack/react-router";
import path from "node:path";
import { ALL_SCOPES, extractAndIngestUploadedVideo } from "@/lib/commands/execute";
import { getSessionUser } from "@/lib/auth/verify.server";
import { ALLOWED_EXT, MAX_BYTES } from "@/lib/media/ffmpeg";

export const Route = createFileRoute("/api/videos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) {
          return Response.json({ ok: false, code: "UNAUTHORIZED", error: "Unauthorized" }, { status: 401 });
        }
        const ct = request.headers.get("content-type") || "";
        if (!ct.includes("multipart/form-data")) {
          return Response.json(
            { ok: false, code: "VALIDATION_ERROR", error: "multipart/form-data required" },
            { status: 400 },
          );
        }
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ ok: false, code: "VALIDATION_ERROR", error: "file field required" }, { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          return Response.json({ ok: false, code: "VALIDATION_ERROR", error: "Video exceeds 48MB cap" }, { status: 400 });
        }
        const ext = path.extname(file.name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          return Response.json(
            { ok: false, code: "VALIDATION_ERROR", error: `Unsupported type ${ext}` },
            { status: 400 },
          );
        }
        const fps = Number(form.get("fps") || 12);
        const name = String(form.get("name") || file.name);
        const buf = Buffer.from(await file.arrayBuffer());
        try {
          const result = await extractAndIngestUploadedVideo(
            {
              userId: user.id,
              source: "rest",
              caller: `user:${user.id}`,
              scopes: ALL_SCOPES,
            },
            { filename: file.name, mimeType: file.type || "video/mp4", bytes: buf, fps, name },
          );
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ ok: false, code: "FFMPEG_FAILED", error: message }, { status: 400 });
        }
      },
    },
  },
});
