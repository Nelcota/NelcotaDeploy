import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";

import { CardTitleRow, TEXT_LINK } from "@/web/components/layout/layout";
import { Card } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import { RecentDeploymentItem } from "./recent-deployment-item";
import type { RecentDeployment } from "./use-recent-deployments";

/** The latest deployments of the project, each linking to its details. */
export function RecentDeploymentsCard({
  projectId,
  deployments,
  canDeploy,
}: {
  readonly projectId: string;
  readonly deployments: readonly RecentDeployment[] | null;
  /** Whether the Deploy button is shown above, so the empty state may point at it. */
  readonly canDeploy: boolean;
}) {
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={HistoryIcon} title="Deploys recentes">
        <Link to="/projects/$projectId/deployments" params={{ projectId }} className={TEXT_LINK}>
          Ver todos
        </Link>
      </CardTitleRow>
      <RecentDeploymentsList
        projectId={projectId}
        deployments={deployments}
        canDeploy={canDeploy}
      />
    </Card>
  );
}

function RecentDeploymentsList({
  projectId,
  deployments,
  canDeploy,
}: {
  readonly projectId: string;
  readonly deployments: readonly RecentDeployment[] | null;
  readonly canDeploy: boolean;
}) {
  if (deployments == null) {
    return <Skeleton className="h-60 rounded-lg" />;
  }
  if (deployments.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {canDeploy
          ? "Nenhum deploy ainda. Use o botão Deploy acima para publicar a primeira versão."
          : "Nenhum deploy ainda."}
      </p>
    );
  }
  return (
    <ul className="-mx-2 divide-y divide-border">
      {deployments.map((deployment) => (
        <li key={deployment.id}>
          <RecentDeploymentItem projectId={projectId} deployment={deployment} />
        </li>
      ))}
    </ul>
  );
}
