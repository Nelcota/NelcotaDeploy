import { Link } from "@tanstack/react-router";
import {
  CalendarCheckIcon,
  CalendarClockIcon,
  ContainerIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  InfoIcon,
  type LucideIcon,
  PackageIcon,
  TimerIcon,
  Undo2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import { durationBetween, formatDateTime, formatDuration } from "@/shared/format";
import {
  DEPLOYMENT_TRIGGER_ICONS,
  DEPLOYMENT_TRIGGER_LABELS,
} from "@/web/components/layout/labels";
import { CardTitleRow } from "@/web/components/layout/layout";
import { Card } from "@/web/components/ui/card";

import { durationEnd, shortSha } from "./deployment-detail";
import type { DeploymentDetailData } from "./use-deployment-detail";

function Detail({
  icon: Icon,
  label,
  children,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground sm:w-32">
        <Icon aria-hidden className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="min-w-0 text-sm break-all sm:truncate">{children}</dd>
    </div>
  );
}

/** Commit, branch, origin, timing, image and container of one deploy. */
export function DeploymentDetailsCard({
  projectId,
  deployment,
  repositoryFullName,
  active,
  now,
}: {
  readonly projectId: string;
  readonly deployment: DeploymentDetailData;
  readonly repositoryFullName: string | null;
  readonly active: boolean;
  readonly now: Date;
}) {
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={InfoIcon} title="Detalhes" />
      <dl className="grid gap-x-10 gap-y-2.5 md:grid-cols-2">
        <Detail icon={GitCommitHorizontalIcon} label="Commit">
          <CommitLink
            sha={deployment.commitSha ?? deployment.requestedCommitSha}
            repositoryFullName={repositoryFullName}
          />
        </Detail>
        <Detail icon={GitBranchIcon} label="Branch">
          <span className="font-mono">{deployment.branch}</span>
        </Detail>
        <Detail icon={DEPLOYMENT_TRIGGER_ICONS[deployment.trigger]} label="Origem">
          {DEPLOYMENT_TRIGGER_LABELS[deployment.trigger]} · {deployment.triggeredByLabel}
        </Detail>
        <TimingDetails deployment={deployment} active={active} now={now} />
        <ArtifactDetails projectId={projectId} deployment={deployment} />
      </dl>
    </Card>
  );
}

function CommitLink({
  sha,
  repositoryFullName,
}: {
  readonly sha: string | null;
  readonly repositoryFullName: string | null;
}) {
  if (sha == null || repositoryFullName == null) {
    return <span className="font-mono">{sha == null ? "—" : shortSha(sha)}</span>;
  }
  return (
    <a
      href={`https://github.com/${repositoryFullName}/commit/${sha}`}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded-sm font-mono underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {shortSha(sha)}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
      <span className="sr-only">(abre no GitHub)</span>
    </a>
  );
}

function TimingDetails({
  deployment,
  active,
  now,
}: {
  readonly deployment: DeploymentDetailData;
  readonly active: boolean;
  readonly now: Date;
}) {
  return (
    <>
      <Detail icon={CalendarClockIcon} label="Início">
        {formatDateTime(deployment.startedAt ?? deployment.createdAt)}
      </Detail>
      <Detail icon={CalendarCheckIcon} label="Fim">
        {deployment.finishedAt == null ? "—" : formatDateTime(deployment.finishedAt)}
      </Detail>
      <Detail icon={TimerIcon} label="Duração">
        <span className="tabular-nums">
          {formatDuration(
            durationBetween(deployment.startedAt, durationEnd(deployment, active, now)),
          )}
        </span>
      </Detail>
    </>
  );
}

function ArtifactDetails({
  projectId,
  deployment,
}: {
  readonly projectId: string;
  readonly deployment: DeploymentDetailData;
}) {
  return (
    <>
      <Detail icon={PackageIcon} label="Imagem">
        <span className="font-mono" title={deployment.imageTag ?? undefined}>
          {deployment.imageTag ?? "—"}
        </span>
      </Detail>
      <Detail icon={ContainerIcon} label="Contêiner">
        <span className="font-mono" title={deployment.containerName ?? undefined}>
          {deployment.containerName ?? "—"}
        </span>
      </Detail>
      {deployment.sourceDeploymentId == null ? null : (
        <Detail icon={Undo2Icon} label="Imagem de">
          <Link
            to="/projects/$projectId/deployments/$deploymentId"
            params={{ projectId, deploymentId: deployment.sourceDeploymentId }}
            className="underline underline-offset-4"
          >
            deploy anterior
          </Link>
        </Detail>
      )}
    </>
  );
}
