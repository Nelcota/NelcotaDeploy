import { Fragment, type ReactNode } from "react";

import { formatDayHeading } from "@/shared/format";
import { useNow } from "@/web/components/clock/use-now";
import { DayHeading, List } from "@/web/components/layout/layout";
import { Button } from "@/web/components/ui/button";

import type { DeploymentHistory, DeploymentItem } from "./use-deployment-history";

/** Deploys split under day headings, each rendered by `renderRow`. */
export function DeploymentHistoryList({
  groups,
  renderRow,
}: {
  readonly groups: DeploymentHistory["groups"];
  readonly renderRow: (deployment: DeploymentItem) => ReactNode;
}) {
  const now = useNow();
  return (
    <List>
      {groups.map(([day, items]) => (
        <Fragment key={day}>
          <DayHeading>{formatDayHeading(items[0]?.createdAt ?? "", now)}</DayHeading>
          {items.map((deployment) => renderRow(deployment))}
        </Fragment>
      ))}
    </List>
  );
}

/** Loads the next page of the history; nothing when every deploy is already listed. */
export function LoadMoreButton({
  deployments,
}: {
  readonly deployments: DeploymentHistory["deployments"];
}) {
  if (deployments.hasNextPage === false) {
    return null;
  }
  return (
    <div className="flex justify-center">
      <Button
        variant="outline"
        disabled={deployments.isFetchingNextPage}
        onClick={() => void deployments.fetchNextPage()}
      >
        {deployments.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
      </Button>
    </div>
  );
}
