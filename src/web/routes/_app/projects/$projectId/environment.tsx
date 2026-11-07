import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { ENVIRONMENT_SECTIONS } from "@/web/components/environment/navigation/environment-destinations";
import { useCan } from "@/web/components/shell/use-permissions";

export const Route = createFileRoute("/_app/projects/$projectId/environment")({
  component: EnvironmentLayout,
});
function EnvironmentLayout() {
  const { projectId } = Route.useParams();
  const can = useCan();
  return (
    <>
      <nav aria-label="Páginas de variáveis">
        <ul className="flex flex-wrap gap-2">
          {ENVIRONMENT_SECTIONS.filter(
            (page) => page.permission == null || can(page.permission),
          ).map((page) => (
            <li key={page.to}>
              <Link
                to={page.to}
                params={{ projectId }}
                activeOptions={{ exact: true }}
                className="inline-flex min-h-9 items-center rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-well hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[status=active]:bg-well data-[status=active]:text-foreground"
              >
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
