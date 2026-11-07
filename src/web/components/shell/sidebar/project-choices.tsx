import { useId, useState } from "react";

import {
  PINNED_PROJECT_LIMIT,
  togglePinnedProject,
  visiblePinnedProjectIds,
} from "@/web/components/shell/sidebar/sidebar-preferences";
import type { SidebarProject } from "@/web/components/shell/sidebar/sidebar-project-link";
import type { SidebarState } from "@/web/components/shell/sidebar/use-sidebar-preferences";
import { Checkbox } from "@/web/components/ui/checkbox";
import { Input } from "@/web/components/ui/input";

const MAX_PROJECT_SEARCH_LENGTH = 128;

function ProjectChoice({
  project,
  pinnedIds,
  availableIds,
  sidebar,
}: {
  readonly project: SidebarProject;
  readonly pinnedIds: readonly string[];
  readonly availableIds: readonly string[];
  readonly sidebar: SidebarState;
}) {
  const checked = pinnedIds.includes(project.id);
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 hover:bg-well has-disabled:opacity-50">
      <Checkbox
        checked={checked}
        disabled={checked === false && pinnedIds.length >= PINNED_PROJECT_LIMIT}
        onCheckedChange={() =>
          sidebar.updatePreferences(
            togglePinnedProject(sidebar.preferences, project.id, availableIds),
          )
        }
      />
      <span className="min-w-0 truncate text-sm">{project.name}</span>
    </label>
  );
}

export function ProjectChoices({
  projects,
  sidebar,
}: {
  readonly projects: readonly SidebarProject[];
  readonly sidebar: SidebarState;
}) {
  const [search, setSearch] = useState("");
  const inputId = useId();
  const availableIds = projects.map((project) => project.id);
  const pinnedIds = visiblePinnedProjectIds(sidebar.preferences.pinnedProjectIds, availableIds);
  const matches = projects.filter((project) =>
    project.name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
  );
  return (
    <div className="min-w-0 space-y-4">
      <label htmlFor={inputId} className="sr-only">
        Buscar projeto para fixar
      </label>
      <Input
        id={inputId}
        placeholder="Buscar projeto…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        maxLength={MAX_PROJECT_SEARCH_LENGTH}
      />
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {pinnedIds.length} de {PINNED_PROJECT_LIMIT} projetos fixados
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {matches.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Nenhum projeto encontrado.</p>
        ) : null}
        {matches.map((project) => (
          <ProjectChoice
            key={project.id}
            project={project}
            pinnedIds={pinnedIds}
            availableIds={availableIds}
            sidebar={sidebar}
          />
        ))}
      </div>
    </div>
  );
}
