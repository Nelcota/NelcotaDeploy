import { Link } from "@tanstack/react-router";

import { DeploymentStatusBadge, ProjectRuntimeBadge } from "@/web/components/layout/status-badge";
import { Card } from "@/web/components/ui/card";

import type { DashboardSummary } from "./dashboard";

const ROW_CLASS =
  "flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 hover:bg-well focus-visible:outline-2 focus-visible:outline-ring [&>span:first-child]:flex-1 [&>span:first-child]:basis-32";
const SHORTCUT_CLASS =
  "flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 py-2 text-base font-semibold text-brand underline-offset-4 hover:bg-well hover:underline focus-visible:outline-2 focus-visible:outline-ring";
const ARROW_CLASS = "solar-[alt-arrow-right-linear] size-4 shrink-0";

/** Shows actionable projects and deploys ahead of the application counts. */
export function DashboardPriorities({ data }: { readonly data: DashboardSummary }) {
  return (
    <div className="@container">
      <div className="grid gap-3 @min-[42rem]:grid-cols-2">
        <ProjectsNeedingAttention projects={data.projectsNeedingAttention} />
        <ActiveDeployments deploys={data.activeDeployments} />
      </div>
    </div>
  );
}

function ProjectsNeedingAttention({
  projects,
}: {
  readonly projects: DashboardSummary["projectsNeedingAttention"];
}) {
  return (
    <Card className="min-w-0 gap-2 p-3">
      <h2>
        <Link to="/projects" search={{ status: "offline" }} className={SHORTCUT_CLASS}>
          Projetos que precisam de atenção
          <span aria-hidden className={ARROW_CLASS} />
        </Link>
      </h2>
      {projects.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Nenhum projeto com problema registrado.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className={ROW_CLASS}
              >
                <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                  {project.name}
                </span>
                <ProjectRuntimeBadge status={project.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActiveDeployments({
  deploys,
}: {
  readonly deploys: DashboardSummary["activeDeployments"];
}) {
  return (
    <Card className="min-w-0 gap-2 p-3">
      <h2>
        <Link to="/deployments" search={{ status: "active" }} className={SHORTCUT_CLASS}>
          Deploys em andamento
          <span aria-hidden className={ARROW_CLASS} />
        </Link>
      </h2>
      {deploys.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          Nenhum deploy em andamento ou na fila.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {deploys.map((deployment) => (
            <li key={deployment.id}>
              <Link
                to="/projects/$projectId/deployments/$deploymentId"
                params={{ projectId: deployment.projectId, deploymentId: deployment.id }}
                className={ROW_CLASS}
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="block text-sm font-medium">{deployment.projectName}</span>
                  <span className="block text-xs text-muted-foreground">{deployment.branch}</span>
                </span>
                <DeploymentStatusBadge status={deployment.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
