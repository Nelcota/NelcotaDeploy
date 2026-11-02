import { Link } from "@tanstack/react-router";

import { cn } from "@/web/components/ui/class-names";

const LINK_CLASS =
  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * Production and staging of one project, side by side; shown only when the project has a
 * staging environment.
 */
export function EnvironmentSwitcher({
  currentProjectId,
  environments,
}: {
  readonly currentProjectId: string;
  readonly environments: { readonly productionId: string; readonly stagingId: string | null };
}) {
  if (environments.stagingId == null) {
    return null;
  }
  const options = [
    { projectId: environments.productionId, label: "Produção" },
    { projectId: environments.stagingId, label: "Staging" },
  ];
  return (
    <nav aria-label="Ambiente" className="inline-flex gap-1 rounded-lg bg-well p-1">
      {options.map((option) => {
        const current = option.projectId === currentProjectId;
        return (
          <Link
            key={option.projectId}
            to="/projects/$projectId"
            params={{ projectId: option.projectId }}
            aria-current={current ? "page" : undefined}
            className={cn(
              LINK_CLASS,
              current
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/70"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
