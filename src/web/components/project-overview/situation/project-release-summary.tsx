import { Link } from "@tanstack/react-router";
import { GitCommitHorizontalIcon, RocketIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatRelativeTime } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { shortSha } from "@/web/components/deployment-detail/deployment-detail";
import { ContainerStateBadge, DeploymentStatusBadge } from "@/web/components/layout/status-badge";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Card } from "@/web/components/ui/card";

import { type LatestDeployment, useLatestDeployment } from "./use-latest-deployment";

function ReleaseLink({
  projectId,
  deploymentId,
  children,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to="/projects/$projectId/deployments/$deploymentId"
      params={{ projectId, deploymentId }}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
      <span aria-hidden className="solar-[alt-arrow-right-linear] size-3.5 shrink-0" />
    </Link>
  );
}

function LiveRelease({ details }: { readonly details: ProjectDetails }) {
  const { liveDeployment, project } = details;
  const container = details.containers.find((item) => item.deploymentId === liveDeployment?.id);
  return (
    <Card className="min-w-0 gap-1 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GitCommitHorizontalIcon aria-hidden className="size-4 text-muted-foreground" />
          Versão no ar
        </h2>
        {liveDeployment == null ? null : (
          <ContainerStateBadge
            state={container?.state ?? null}
            health={container?.health ?? null}
          />
        )}
      </div>
      {liveDeployment == null ? (
        <p className="text-sm text-muted-foreground">Nenhuma versão publicada.</p>
      ) : (
        <>
          <ReleaseLink projectId={project.id} deploymentId={liveDeployment.id}>
            <span className="font-mono">
              {liveDeployment.commitSha == null ? "Ver versão" : shortSha(liveDeployment.commitSha)}
            </span>
          </ReleaseLink>
          {liveDeployment.commitMessage == null ? null : (
            <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {liveDeployment.commitMessage}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function LatestRelease({ latest }: { readonly latest: LatestDeployment }) {
  const now = useNow();
  const sha = latest.commitSha ?? latest.requestedCommitSha;
  return (
    <>
      <ReleaseLink projectId={latest.projectId} deploymentId={latest.id}>
        {latest.status === "failed" ? "Ver falha do deploy" : "Ver deploy"}
        {sha == null ? null : <span className="font-mono text-xs">{shortSha(sha)}</span>}
      </ReleaseLink>
      <time dateTime={latest.createdAt} className="text-xs text-muted-foreground">
        {formatRelativeTime(latest.createdAt, now)}
      </time>
    </>
  );
}

function latestDeploymentMessage(pending: boolean, failed: boolean) {
  if (pending) {
    return "Carregando…";
  }

  return failed ? "Não foi possível consultar o último deploy." : "Nenhum deploy solicitado.";
}

function LatestReleaseCard({ projectId }: { readonly projectId: string }) {
  const query = useLatestDeployment(projectId);
  const latest = query.data?.at(0);
  return (
    <Card className="min-w-0 gap-1 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <RocketIcon aria-hidden className="size-4 text-muted-foreground" />
          Último deploy
        </h2>
        {latest == null ? null : <DeploymentStatusBadge status={latest.status} />}
      </div>
      {latest == null ? (
        <p className="text-sm text-muted-foreground">
          {latestDeploymentMessage(query.isPending, query.isError)}
        </p>
      ) : (
        <LatestRelease latest={latest} />
      )}
    </Card>
  );
}

/** Puts the live version and the latest attempt side by side when there is room. */
export function ProjectReleaseSummary({ details }: { readonly details: ProjectDetails }) {
  return (
    <section aria-label="Versões do projeto" className="@container">
      <div className="grid gap-3 @min-[36rem]:grid-cols-2">
        <LiveRelease details={details} />
        <LatestReleaseCard projectId={details.project.id} />
      </div>
    </section>
  );
}
