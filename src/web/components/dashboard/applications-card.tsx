import { Link } from "@tanstack/react-router";
import { ListIcon } from "lucide-react";

import { CardTitleRow, TEXT_LINK } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { useCan } from "@/web/components/shell/use-permissions";
import { Card } from "@/web/components/ui/card";

import { ApplicationFilterGroup } from "./application-filter";
import { ApplicationsList, NewProjectLink } from "./applications-list";
import { useApplications } from "./use-applications";

/** Every application with a state filter, linking to the full project list. */
export function ApplicationsCard() {
  const can = useCan();
  const canCreate = can("project:write");
  const { projects, all, visible, filter, setFilter } = useApplications();
  return (
    <Card className="gap-5 p-5">
      <CardTitleRow
        icon={ListIcon}
        title="Todas as aplicações"
        count={projects.data == null ? null : all.length}
      >
        <Link to="/projects" className={TEXT_LINK}>
          Ver todos
        </Link>
        {canCreate ? <NewProjectLink /> : null}
      </CardTitleRow>
      <ApplicationFilterGroup value={filter} onChange={setFilter} />
      {projects.isPending ? <ListSkeleton rows={3} /> : null}
      {projects.isError ? (
        <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
      ) : null}
      {projects.data == null ? null : (
        <ApplicationsList
          all={all}
          visible={visible}
          canCreate={canCreate}
          onClearFilter={() => setFilter("all")}
        />
      )}
    </Card>
  );
}
