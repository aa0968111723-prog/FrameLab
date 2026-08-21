import { createFileRoute } from "@tanstack/react-router";
import { StudioApp } from "@/components/workstation/studio-app";

export const Route = createFileRoute("/studio/$projectId")({
  component: StudioPage,
});

function StudioPage() {
  const { projectId } = Route.useParams();
  return <StudioApp projectId={projectId} />;
}
