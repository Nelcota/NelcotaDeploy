import type { ReactNode } from "react";

import { ErrorState } from "@/web/components/layout/states";
import {
  FirstPublicationConfirmation,
  firstPublicationConfirmation,
} from "@/web/components/projects/first-deployment/first-publication-confirmation";
import { TabHeader } from "@/web/components/projects/project-header";
import { cn } from "@/web/components/ui/class-names";

import {
  BackToDeploymentsLink,
  DeploymentDetailSkeleton,
  DeploymentTitle,
  StagesCard,
} from "./deployment-detail-parts";
import { DeploymentDetailsCard } from "./deployment-details-card";
import { DeploymentFailureNotice } from "./deployment-failure-notice";
import { DeploymentHeaderAction } from "./deployment-header-action";
import { type DeploymentDetailData, useDeploymentDetail } from "./use-deployment-detail";

/** Progress and outcome of one deployment; its build output has a dedicated page. */
export function DeploymentDetailPage({
  projectId,
  deploymentId,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
}) {
  const { project, deployment, active, now } = useDeploymentDetail(projectId, deploymentId);
  if (deployment.isError) {
    return (
      <DetailSection projectId={projectId} label="Detalhes do deploy">
        <ErrorState error={deployment.error} onRetry={() => void deployment.refetch()} />
      </DetailSection>
    );
  }
  const data = deployment.data;
  if (data == null) {
    return (
      <DetailSection projectId={projectId} label="Carregando deploy" busy>
        <DeploymentDetailSkeleton />
      </DetailSection>
    );
  }
  if (data.projectId !== projectId) {
    return <p role="alert">Deploy não encontrado neste projeto.</p>;
  }
  return (
    <section
      aria-label="Detalhes do deploy"
      className={cn("space-y-6", data.status === "failed" && "max-sm:space-y-3")}
    >
      <DeploymentOutcome deployment={data} details={project.data} />
      <DeploymentHeader projectId={projectId} deployment={data} />
      {data.status === "failed" ? <FailureActions projectId={projectId} deployment={data} /> : null}
      <StagesCard deployment={data} />
      <DeploymentDetailsCard
        projectId={projectId}
        deployment={data}
        repositoryFullName={project.data?.project.repositoryFullName ?? null}
        active={active}
        now={now}
      />
    </section>
  );
}

function DeploymentOutcome({ deployment, details }: Parameters<typeof DeploymentFailureNotice>[0]) {
  const failed = deployment.status === "failed";
  const confirmation =
    deployment.status === "succeeded" && firstPublicationConfirmation(details, deployment.id);
  return (
    <>
      <p role="status" className="sr-only">
        {failed ? "O deploy falhou. O diagnóstico está disponível acima das etapas." : null}
        {confirmation ? "Primeira versão publicada." : null}
      </p>
      {failed ? <DeploymentFailureNotice deployment={deployment} details={details} /> : null}
      {confirmation && details != null ? <FirstPublicationConfirmation details={details} /> : null}
    </>
  );
}

function FailureActions({ projectId, deployment }: Parameters<typeof DeploymentHeaderAction>[0]) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <BackToDeploymentsLink projectId={projectId} />
      <DeploymentHeaderAction projectId={projectId} deployment={deployment} />
    </div>
  );
}

function DetailSection({
  projectId,
  label,
  busy = false,
  children,
}: {
  readonly projectId: string;
  readonly label: string;
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={label} aria-busy={busy ? true : undefined} className="space-y-6">
      <BackToDeploymentsLink projectId={projectId} />
      {children}
    </section>
  );
}

function DeploymentHeader({
  projectId,
  deployment,
}: {
  readonly projectId: string;
  readonly deployment: DeploymentDetailData;
}) {
  return (
    <div className="space-y-3">
      {deployment.status === "failed" ? null : <BackToDeploymentsLink projectId={projectId} />}
      <TabHeader
        title={<DeploymentTitle deployment={deployment} />}
        description={deployment.commitMessage ?? "sem mensagem de commit"}
        actions={
          deployment.status === "failed" ? null : (
            <DeploymentHeaderAction projectId={projectId} deployment={deployment} />
          )
        }
      />
    </div>
  );
}
