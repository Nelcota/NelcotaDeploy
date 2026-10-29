import { Link } from "@tanstack/react-router";
import { FolderGit2Icon, GitBranchIcon, HandIcon, ZapIcon } from "lucide-react";

import type { DeploymentStatus } from "@/deployments";
import { formatRelativeTime } from "@/shared/format";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/layout/labels";
import { ListRow } from "@/web/components/layout/layout";
import {
  ContainerStateBadge,
  DeploymentStatusBadge,
  StatusPill,
} from "@/web/components/layout/status-badge";
import type { listProjectsFn } from "@/web/functions/projects.functions";

type ProjectRow = Awaited<ReturnType<typeof listProjectsFn>>[number];

function isDeploymentStatus(status: string): status is DeploymentStatus {
  return Object.hasOwn(DEPLOYMENT_STATUS_LABELS, status);
}

function LatestDeployment({ project, now }: { readonly project: ProjectRow; readonly now: Date }) {
  const latest = project.latestDeployment;
  if (latest == null || isDeploymentStatus(latest.status) === false) {
    return <StatusPill tone="neutral" label="Sem deploy" />;
  }
  return (
    <div className="space-y-0.5">
      <DeploymentStatusBadge status={latest.status} />
      <p className="text-xs text-muted-foreground">{formatRelativeTime(latest.createdAt, now)}</p>
    </div>
  );
}

function RepositoryCell({ project }: { readonly project: ProjectRow }) {
  return (
    <div className="hidden w-56 min-w-0 shrink-0 space-y-0.5 text-sm md:block">
      <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <FolderGit2Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{project.repositoryFullName}</span>
      </p>
      <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{project.branch}</span>
      </p>
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
  return (
    <ListRow>
      <div className="min-w-0 flex-1">
        {/* The link covers the whole row, so the row opens the project and stays a real link. */}
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          {project.name}
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">{project.slug}</p>
      </div>
      <RepositoryCell project={project} />
      <div className="hidden w-36 shrink-0 lg:block">
        <LatestDeployment project={project} now={now} />
      </div>
      <p className="hidden w-28 shrink-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex">
        {project.autoDeploy ? (
          <ZapIcon aria-hidden className="size-3.5 shrink-0" />
        ) : (
          <HandIcon aria-hidden className="size-3.5 shrink-0" />
        )}
        <span className="sr-only">Deploy </span>
        {project.autoDeploy ? "Automático" : "Manual"}
      </p>
      <div className="flex shrink-0 justify-end md:w-40">
        {project.deploymentsApproved ? (
          <ContainerStateBadge state={project.containerState} health={project.containerHealth} />
        ) : (
          <StatusPill tone="warning" label="Aguardando aprovação" />
        )}
      </div>
    </ListRow>
  );
}
