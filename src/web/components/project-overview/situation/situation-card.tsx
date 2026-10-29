import {
  ActivityIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  RotateCwIcon,
} from "lucide-react";

import { CONTAINER_HEALTH_LABELS, CONTAINER_STATE_LABELS } from "@/web/components/layout/labels";
import { CardTitleRow, StatusTile } from "@/web/components/layout/layout";
import { currentContainer } from "@/web/components/projects/project-header";
import type { ProjectDetails } from "@/web/components/projects/project-query";
import { Card } from "@/web/components/ui/card";

import type { RecentDeployment } from "../use-recent-deployments";
import { CommitTile } from "./commit-tile";
import { LatestDeploymentTile, UptimeTile } from "./deployment-time-tiles";

type Container = NonNullable<ReturnType<typeof currentContainer>>;

/** The five figures that tell whether the application is serving the latest code. */
export function SituationCard({
  details,
  latest,
  latestLoading,
}: {
  readonly details: ProjectDetails;
  readonly latest: RecentDeployment | null;
  readonly latestLoading: boolean;
}) {
  const container = currentContainer(details);
  const runningContainer = container?.state === "running" ? container : null;
  return (
    <Card className="gap-4 p-5">
      <CardTitleRow icon={ActivityIcon} title="Situação atual" />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <ContainerTile container={container} />
        <LatestDeploymentTile latest={latest} loading={latestLoading} />
        <CommitTile currentDeploymentId={details.project.currentDeploymentId} />
        <StatusTile
          value={container == null ? "—" : container.restartCount}
          label="Reinícios"
          icon={RotateCwIcon}
          iconClassName={(container?.restartCount ?? 0) > 0 ? "text-warning" : ""}
        />
        <UptimeTile startedAt={runningContainer?.startedAt ?? null} />
      </dl>
    </Card>
  );
}

function ContainerTile({ container }: { readonly container: Container | null }) {
  if (container == null) {
    return (
      <StatusTile
        value="Sem contêiner"
        label="Contêiner"
        icon={CircleDashedIcon}
        iconClassName=""
      />
    );
  }
  const healthy = container.state === "running" && container.health !== "unhealthy";
  return (
    <StatusTile
      value={CONTAINER_STATE_LABELS[container.state] ?? container.state}
      detail={
        container.health == null
          ? undefined
          : (CONTAINER_HEALTH_LABELS[container.health] ?? container.health)
      }
      label="Contêiner"
      icon={healthy ? CircleCheckIcon : CircleAlertIcon}
      iconClassName={healthy ? "text-success" : "text-warning"}
    />
  );
}
