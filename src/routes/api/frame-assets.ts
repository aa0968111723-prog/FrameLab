import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { getFrameMeta, getProject, getTimeline } from "@/lib/framelab/repo";
import { isInlineJpeg, readProjectRel, type AssetTier } from "@/lib/storage/frame-assets";

const TIERS = new Set<AssetTier>(["full", "preview", "thumbnail"]);

export const Route = createFileRoute("/api/frame-assets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) {
          return new Response("未登入", { status: 401 });
        }
        const url = new URL(request.url);
        const frameId = url.searchParams.get("frameId") || "";
        const tierRaw = (url.searchParams.get("tier") || "preview") as AssetTier;
        if (!frameId || !TIERS.has(tierRaw)) {
          return new Response("需要 frameId 與合法 tier", { status: 400 });
        }
        const frame = await getFrameMeta(frameId);
        if (!frame) return new Response("找不到影格", { status: 404 });
        const timeline = await getTimeline(frame.timeline_id);
        if (!timeline) return new Response("找不到時間軸", { status: 404 });
        const project = await getProject(user.id, timeline.project_id);
        if (!project) return new Response("找不到這個專案", { status: 404 });

        const rel =
          tierRaw === "full"
            ? frame.full_asset
            : tierRaw === "preview"
              ? frame.preview_asset || frame.full_asset
              : frame.thumbnail_asset || frame.preview_asset || frame.full_asset;

        let buf: Buffer | null = null;
        if (rel) {
          try {
            buf = await readProjectRel(timeline.project_id, rel);
          } catch {
            buf = null;
          }
        }
        if (!buf && tierRaw === "thumbnail" && isInlineJpeg(frame.thumbnail_data)) {
          buf = Buffer.from(frame.thumbnail_data, "base64");
        }
        if (!buf && isInlineJpeg(frame.image_data)) {
          buf = Buffer.from(frame.image_data, "base64");
        }
        if (!buf) return new Response("找不到素材", { status: 404 });

        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        });
      },
    },
  },
});
