import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/studio")({
  component: StudioLayout,
});

function StudioLayout() {
  return <Outlet />;
}
