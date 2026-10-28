import { Link } from "@tanstack/react-router";

import type { DeploymentStatus } from "@/deployments";
import { formatRelativeTime } from "@/shared/format";
import type { listProjectsFn } from "@/web/functions/projects.functions";

import { DEPLOYMENT_STATUS_LABELS } from "./labels";
import { ListRow } from "./layout";
import { containerAccent } from "./project-accent";
import { ContainerStateBadge, DeploymentStatusBadge, StatusPill } from "./status-badge";

type ProjectRow = Awaited<ReturnType<typeof listProjectsFn>>[number];

function isDeploymentStatus(status: string): status is DeploymentStatus {
  return Object.hasOwn(DEPLOYMENT_STATUS_LABELS, status);
}

function LatestDeployment({ project, now }: { readonly project: ProjectRow; readonly now: Date }) {
  const latest = project.latestDeployment;
  if (latest == null || isDeploymentStatus(latest.status) === false) {
    return <p className="text-xs text-faint">sem deploy</p>;
  }
  return (
    <div className="space-y-0.5">
      <DeploymentStatusBadge status={latest.status} />
      <p className="text-xs text-faint">{formatRelativeTime(latest.createdAt, now)}</p>
    </div>
  );
}

/** One project in a {@link List}: name, repository, last deploy and container state. */
export function ProjectListRow({
  project,
  now,
}: {
  readonly project: ProjectRow;
  readonly now: Date;
}) {
  const accent = project.deploymentsApproved
    ? containerAccent(project.containerState, project.containerHealth)
    : "warning";
  return (
    <ListRow accent={accent}>
      <div className="min-w-0 flex-1">
        {/* The link covers the whole row, so the row opens the project and stays a real link. */}
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {project.name}
        </Link>
        <p className="truncate font-mono text-xs text-faint">{project.slug}</p>
      </div>
      <div className="hidden w-56 min-w-0 shrink-0 text-sm md:block">
        <p className="truncate text-muted-foreground">{project.repositoryFullName}</p>
        <p className="truncate font-mono text-xs text-faint">{project.branch}</p>
      </div>
      <div className="hidden w-36 shrink-0 lg:block">
        <LatestDeployment project={project} now={now} />
      </div>
      <p className="hidden w-20 shrink-0 text-xs text-muted-foreground lg:block">
        {project.autoDeploy ? "Automático" : "Manual"}
      </p>
      <div className="flex w-40 shrink-0 justify-end">
        {project.deploymentsApproved ? (
          <ContainerStateBadge state={project.containerState} health={project.containerHealth} />
        ) : (
          <StatusPill tone="warning" label="Aguardando aprovação" />
        )}
      </div>
    </ListRow>
  );
}
