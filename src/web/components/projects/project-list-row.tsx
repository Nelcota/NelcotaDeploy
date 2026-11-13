import { Link } from "@tanstack/react-router";
import { CircleCheckIcon, FolderGit2Icon, GitBranchIcon, HandIcon, ZapIcon } from "lucide-react";

import type { DeploymentStatus } from "@/deployments";
import { formatRelativeTime } from "@/shared/format";
import { HttpsDiagnosticLink } from "@/web/components/domains/dns/https-diagnostic-link";
import { HttpsRecoveryCard } from "@/web/components/domains/dns/https-recovery-card";
import { DEPLOYMENT_STATUS_LABELS } from "@/web/components/layout/labels";
import { ListRow, Tag } from "@/web/components/layout/layout";
import {
  DeploymentStatusBadge,
  ProjectRuntimeBadge,
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
    <div>
      <ProjectSummaryRow project={project} now={now} />
      {project.httpsIssueDomains.length === 0 ? null : (
        <div className="space-y-2 px-4 pb-3 sm:px-5">
          <p className="text-xs font-semibold text-warning">Problemas no HTTPS</p>
          <ul role="list" className="grid gap-2 sm:grid-cols-2">
            {project.httpsIssueDomains.map((hostname) => (
              <li key={hostname} className="min-w-0">
                <HttpsDiagnosticLink projectId={project.id} hostname={hostname} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {project.httpsRecoveries.length === 0 ? null : (
        <div className="space-y-2 px-4 pb-3 sm:px-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
            HTTPS restabelecido
          </p>
          <ul role="list" className="grid gap-2 sm:grid-cols-2">
            {project.httpsRecoveries.map(({ hostname, recoveredAt }) => (
              <li key={hostname} className="min-w-0">
                <HttpsRecoveryCard
                  projectId={project.id}
                  hostname={hostname}
                  recoveredAt={recoveredAt}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProjectSummaryRow({ project, now }: { readonly project: ProjectRow; readonly now: Date }) {
  return (
    <ListRow className="flex-wrap sm:flex-nowrap">
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        {/* The link covers the whole row, so the row opens the project and stays a real link. */}
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className="block font-medium [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset sm:truncate"
        >
          {project.name}
        </Link>
        {project.environmentName == null ? null : (
          <span className="mr-1.5 align-middle">
            <Tag>Staging</Tag>
          </span>
        )}
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
      <div className="flex max-w-full shrink-0 flex-col items-start gap-1 sm:items-end md:w-40">
        {project.deploymentsApproved || project.runtimeStatus !== "never-deployed" ? (
          <ProjectRuntimeBadge status={project.runtimeStatus} />
        ) : null}
        {project.deploymentsApproved ? null : (
          <StatusPill tone="warning" label="Aguardando aprovação" className="whitespace-normal" />
        )}
      </div>
    </ListRow>
  );
}
