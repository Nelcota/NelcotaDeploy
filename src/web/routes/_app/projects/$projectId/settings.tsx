import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/projects/$projectId/settings")({
  head: () => ({ meta: [{ title: "Configurações do projeto · Nelcota Deploy" }] }),
  component: Outlet,
});
