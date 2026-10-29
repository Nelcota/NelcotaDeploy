import { Link } from "@tanstack/react-router";
import { BoxesIcon, ListIcon, PlusIcon } from "lucide-react";

import { useNow } from "@/web/components/clock/use-now";
import { List } from "@/web/components/layout/layout";
import { EmptyState } from "@/web/components/layout/states";
import { ProjectListRow } from "@/web/components/projects/project-list-row";
import { Button } from "@/web/components/ui/button";
import type { listProjectsFn } from "@/web/functions/projects.functions";

type ProjectRow = Awaited<ReturnType<typeof listProjectsFn>>[number];

/** Link to the new-project form, shown to users who may create projects. */
export function NewProjectLink() {
  return (
    <Button size="sm" asChild>
      <Link to="/projects/new">
        <PlusIcon aria-hidden />
        Novo projeto
      </Link>
    </Button>
  );
}

/** The filtered applications, or why the list is empty. */
export function ApplicationsList({
  all,
  visible,
  canCreate,
  onClearFilter,
}: {
  readonly all: readonly ProjectRow[];
  readonly visible: readonly ProjectRow[];
  readonly canCreate: boolean;
  readonly onClearFilter: () => void;
}) {
  const now = useNow();
  if (all.length === 0) {
    return (
      <EmptyState
        icon={BoxesIcon}
        title="Nenhuma aplicação ainda"
        description="Conecte um repositório para fazer o primeiro deploy."
        action={canCreate ? <NewProjectLink /> : undefined}
      />
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={ListIcon}
        title="Nenhuma aplicação neste filtro"
        action={
          <Button size="sm" variant="outline" onClick={onClearFilter}>
            Limpar filtro
          </Button>
        }
      />
    );
  }
  return (
    <List>
      {visible.map((project) => (
        <ProjectListRow key={project.id} project={project} now={now} />
      ))}
    </List>
  );
}
