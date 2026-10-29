import { Link } from "@tanstack/react-router";
import { BoxesIcon, PlusIcon, SearchIcon } from "lucide-react";

import { useNow } from "@/web/components/clock/use-now";
import { List } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { ProjectListRow } from "@/web/components/projects/project-list-row";
import { Button } from "@/web/components/ui/button";

import type { useProjectList } from "./use-project-list";

/** Link to the new-project form, in the page header or the empty state. */
export function NewProjectButton({
  label,
  size,
}: {
  readonly label: string;
  readonly size: "default" | "sm";
}) {
  return (
    <Button size={size} asChild>
      <Link to="/projects/new">
        <PlusIcon aria-hidden />
        {label}
      </Link>
    </Button>
  );
}

/** Nothing to list: either the search or filter hides every project, or none exists yet. */
function EmptyProjectList({
  nothingMatches,
  canCreate,
  onClearFilters,
}: {
  readonly nothingMatches: boolean;
  readonly canCreate: boolean;
  readonly onClearFilters: () => void;
}) {
  if (nothingMatches) {
    return (
      <EmptyState
        icon={SearchIcon}
        title="Nenhum projeto encontrado"
        description="Nenhum projeto corresponde à busca ou ao filtro."
        action={
          <Button size="sm" variant="outline" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={BoxesIcon}
      title="Nenhum projeto ainda"
      description="Cadastre uma aplicação apontando para um repositório GitHub com Dockerfile."
      action={canCreate ? <NewProjectButton label="Criar projeto" size="sm" /> : undefined}
    />
  );
}

/** The project list with its error, loading and empty states. */
export function ProjectListContent({
  list,
  canCreate,
  onClearFilters,
}: {
  readonly list: ReturnType<typeof useProjectList>;
  readonly canCreate: boolean;
  readonly onClearFilters: () => void;
}) {
  const now = useNow();
  const { projects, rows } = list;
  if (projects.isError) {
    return <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />;
  }
  if (projects.data == null) {
    return <ListSkeleton rows={5} />;
  }
  if (rows.length === 0) {
    return (
      <EmptyProjectList
        nothingMatches={list.hasProjects || list.filtering}
        canCreate={canCreate}
        onClearFilters={onClearFilters}
      />
    );
  }
  return (
    <section aria-label="Lista de projetos">
      <List>
        {rows.map((project) => (
          <ProjectListRow key={project.id} project={project} now={now} />
        ))}
      </List>
    </section>
  );
}
