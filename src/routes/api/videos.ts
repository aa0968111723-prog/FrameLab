import { createFileRoute } from "@tanstack/react-router";
import path from "node:path";
import { ALL_SCOPES, startUploadedVideoIngest } from "@/lib/commands/execute";
import { getSessionUser } from "@/lib/auth/verify.server";
import { parseFpsField } from "@/lib/domain/fps";
import { ALLOWED_EXT, MAX_BYTES } from "@/lib/media/ffmpeg";

export const Route = createFileRoute("/api/videos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) {
          return Response.json({ ok: false, code: "UNAUTHORIZED", error: "未登入" }, { status: 401 });
        }
        const ct = request.headers.get("content-type") || "";
        if (!ct.includes("multipart/form-data")) {
          return Response.json(
            { ok: false, code: "VALIDATION_ERROR", error: "需要 multipart/form-data" },
            { status: 400 },
          );
        }
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ ok: false, code: "VALIDATION_ERROR", error: "需要 file 欄位" }, { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          return Response.json({ ok: false, code: "VALIDATION_ERROR", error: "影片超過 512MB" }, { status: 400 });
        }
        const ext = path.extname(file.name).toLowerCase();
        if (!ALLOWED_EXT.has(ext)) {
          return Response.json(
            { ok: false, code: "VALIDATION_ERROR", error: `不支援的格式 ${ext}` },
            { status: 400 },
          );
        }
        const extracted = parseFpsField(form.get("fps") as string | null);
        const fps = extracted === "auto" ? 0 : extracted;
        const playbackRaw = form.get("playbackFps");
        const playbackFps =
          playbackRaw == null || String(playbackRaw).trim() === "" ? "same" : String(playbackRaw);
        const name = String(form.get("name") || file.name);
        const buf = Buffer.from(await file.arrayBuffer());
        try {
          const started = await startUploadedVideoIngest(
            {
              userId: user.id,
              source: "rest",
              caller: `user:${user.id}`,
              scopes: ALL_SCOPES,
            },
            { filename: file.name, mimeType: file.type || "video/mp4", bytes: buf, fps, playbackFps, name },
          );
          // Don't await the extract — the client polls the job. Never return
          // thousands of JPEG base64 blobs in this response.
          void started.done.catch(() => undefined);
          return Response.json(
            {
              ok: true,
              projectId: started.projectId,
              timelineId: started.timelineId,
              videoId: started.videoId,
              jobId: started.jobId,
              status: "running",
            },
            { status: 202 },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ ok: false, code: "FFMPEG_FAILED", error: message }, { status: 400 });
        }
      },
    },
  },
});
