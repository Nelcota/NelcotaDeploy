import type { ReactNode } from "react";

import { ErrorState } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";

import {
  BackToDeploymentsLink,
  DeploymentDetailSkeleton,
  DeploymentLogs,
  DeploymentTitle,
  FailureNotice,
  StagesCard,
} from "./deployment-detail-parts";
import { DeploymentDetailsCard } from "./deployment-details-card";
import { DeploymentHeaderAction } from "./deployment-header-action";
import { type DeploymentDetailData, useDeploymentDetail } from "./use-deployment-detail";

/** One deploy: stages, failure reason, details and live build logs. */
export function DeploymentDetailPage({
  projectId,
  deploymentId,
}: {
  readonly projectId: string;
  readonly deploymentId: string;
}) {
  const { project, deployment, active, now, onLogEnd } = useDeploymentDetail(
    projectId,
    deploymentId,
  );
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
  return (
    <section aria-label="Detalhes do deploy" className="space-y-6">
      <DeploymentHeader projectId={projectId} deployment={data} />
      <StagesCard deployment={data} />
      {data.status === "failed" && data.errorMessage != null ? (
        <FailureNotice
          errorMessage={data.errorMessage}
          previousVersionLive={project.data?.project.currentDeploymentId != null}
        />
      ) : null}
      <DeploymentDetailsCard
        projectId={projectId}
        deployment={data}
        repositoryFullName={project.data?.project.repositoryFullName ?? null}
        active={active}
        now={now}
      />
      <DeploymentLogs deployment={data} active={active} onEnd={onLogEnd} />
    </section>
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
      <BackToDeploymentsLink projectId={projectId} />
      <TabHeader
        title={<DeploymentTitle deployment={deployment} />}
        description={deployment.commitMessage ?? "sem mensagem de commit"}
        actions={<DeploymentHeaderAction projectId={projectId} deployment={deployment} />}
      />
    </div>
  );
}
