import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import {
  STATUS_FILTER_VALUES,
  type StatusFilter,
} from "@/web/components/project-list/project-list";
import { ProjectsPage } from "@/web/components/project-list/projects-page";

// The status filter lives in the URL, so a filtered list survives a reload and can be shared.
export const Route = createFileRoute("/_app/projects/")({
  validateSearch: z.object({ status: z.enum(STATUS_FILTER_VALUES).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: "Projetos · Nelcota Deploy" }] }),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const navigate = useNavigate({ from: Route.fullPath });
  const filter: StatusFilter = Route.useSearch().status ?? "all";
  const setFilter = (next: StatusFilter) => {
    void navigate({ search: { status: next === "all" ? undefined : next }, replace: true });
  };
  return <ProjectsPage filter={filter} onFilterChange={setFilter} />;
}
