import { createFileRoute } from "@tanstack/react-router";
import { ProjectHome } from "@/components/workstation/project-home";

export const Route = createFileRoute("/studio/")({
  component: ProjectHome,
});
