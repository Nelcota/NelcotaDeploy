import { FilterXIcon, RocketIcon } from "lucide-react";

import { SegmentedControl } from "@/web/components/layout/overview";
import { EmptyState } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { Button } from "@/web/components/ui/button";

import { STATUS_FILTERS, type StatusFilter } from "../deployment-history";

export function ProjectHistoryHeader({
  statusFilter,
  onStatusFilterChange,
}: {
  readonly statusFilter: StatusFilter;
  readonly onStatusFilterChange: (filter: StatusFilter) => void;
}) {
  return (
    <TabHeader
      title="Deploys"
      actions={
        <SegmentedControl
          label="Filtrar deploys por status"
          options={STATUS_FILTERS}
          value={statusFilter}
          onChange={onStatusFilterChange}
        />
      }
    />
  );
}

export function EmptyHistory({
  filtered,
  onClearFilter,
}: {
  readonly filtered: boolean;
  readonly onClearFilter: () => void;
}) {
  if (filtered === false) {
    return (
      <EmptyState
        icon={RocketIcon}
        title="Nenhum deploy ainda"
        description="Use o botão Deploy acima para publicar a primeira versão."
      />
    );
  }
  return (
    <EmptyState
      icon={FilterXIcon}
      title="Nenhum deploy com este status"
      action={
        <Button variant="outline" size="sm" onClick={onClearFilter}>
          Limpar filtro
        </Button>
      }
    />
  );
}
