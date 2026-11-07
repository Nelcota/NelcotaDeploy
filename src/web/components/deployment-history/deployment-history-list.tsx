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

/** Navigates bounded history pages without retaining previously rendered deployment objects. */
export function LoadMoreButton({
  deployments,
}: {
  readonly deployments: DeploymentHistory["deployments"];
}) {
  if (deployments.hasNextPage === false && deployments.canReset === false) {
    return null;
  }
  return (
    <nav
      aria-label="Paginação do histórico"
      className="flex flex-wrap justify-center gap-3"
      aria-busy={deployments.isFetching}
    >
      {deployments.canReset ? (
        <Button variant="outline" disabled={deployments.isFetching} onClick={deployments.reset}>
          Mais recentes
        </Button>
      ) : null}
      {deployments.hasPreviousPage ? (
        <Button
          variant="outline"
          disabled={deployments.isFetching}
          onClick={deployments.fetchPreviousPage}
        >
          Página anterior
        </Button>
      ) : null}
      <Button
        variant="outline"
        disabled={deployments.isFetchingNextPage || deployments.hasNextPage === false}
        onClick={deployments.fetchNextPage}
      >
        {deployments.isFetchingNextPage ? "Carregando…" : "Próxima página"}
      </Button>
    </nav>
  );
}
