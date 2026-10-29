import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ListChecksIcon, ScrollTextIcon } from "lucide-react";

import { DeploymentStages } from "@/web/components/deployments/deployment-stages";
import { CardTitleRow } from "@/web/components/layout/layout";
import { DeploymentStatusBadge } from "@/web/components/layout/status-badge";
import { LogViewer } from "@/web/components/monitoring/log-viewer";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import { deploymentTitleId } from "./deployment-detail";
import type { DeploymentDetailData } from "./use-deployment-detail";

export function BackToDeploymentsLink({ projectId }: { readonly projectId: string }) {
  return (
    <Link
      to="/projects/$projectId/deployments"
      params={{ projectId }}
      className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      Deploys
    </Link>
  );
}

export function DeploymentDetailSkeleton() {
  return (
    <>
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-[28rem] rounded-xl" />
    </>
  );
}

export function DeploymentTitle({ deployment }: { readonly deployment: DeploymentDetailData }) {
  return (
    <>
      <span>
        Deploy <span className="font-mono">{deploymentTitleId(deployment)}</span>
      </span>
      <DeploymentStatusBadge status={deployment.status} />
    </>
  );
}

export function StagesCard({ deployment }: { readonly deployment: DeploymentDetailData }) {
  return (
    <Card className="gap-5 p-5">
      <CardTitleRow icon={ListChecksIcon} title="Etapas" />
      <DeploymentStages deployment={deployment} />
    </Card>
  );
}

/** Why the deploy failed, and whether the previous version is still serving. */
export function FailureNotice({
  errorMessage,
  previousVersionLive,
}: {
  readonly errorMessage: string;
  readonly previousVersionLive: boolean;
}) {
  return (
    <div className="space-y-1.5 rounded-xl bg-destructive/8 px-5 py-4 ring-1 ring-destructive/25">
      <p className="text-sm font-medium text-destructive">
        {previousVersionLive
          ? "O deploy falhou. A versão anterior continua no ar."
          : "O deploy falhou e a aplicação ainda não está no ar."}
      </p>
      <pre className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
        {errorMessage}
      </pre>
    </div>
  );
}

export function DeploymentLogs({
  deployment,
  active,
  onEnd,
}: {
  readonly deployment: DeploymentDetailData;
  readonly active: boolean;
  readonly onEnd: (summary: unknown) => void;
}) {
  return (
    <>
      <h2 className="flex items-center gap-3 text-base font-semibold">
        <ScrollTextIcon aria-hidden className="size-[1.15rem] text-muted-foreground" />
        Logs do deploy
      </h2>
      <LogViewer
        url={`/api/deployments/${deployment.id}/logs`}
        heightClass={active ? "h-[28rem]" : "max-h-[28rem] min-h-24"}
        downloadName={`deploy-${deployment.id}.log`}
        emptyMessage={
          deployment.status === "queued"
            ? "Aguardando o worker iniciar o deploy…"
            : "Nenhuma linha registrada."
        }
        onEnd={onEnd}
      />
    </>
  );
}
