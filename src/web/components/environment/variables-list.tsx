import type { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import type { EnvironmentVariableView } from "@/environments";
import { filterVariablesByKey } from "@/web/components/forms/variable-filter";
import { List, ListRow } from "@/web/components/layout/layout";
import { EmptyState, ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";

import { VariableRow } from "./variable-row";

type VariableHandlers = {
  readonly canEdit: boolean;
  readonly onEdit: (variable: EnvironmentVariableView) => void;
  readonly onDelete: (variableId: string) => void;
};

/** The variables of a project with a search by name, or the loading, error or empty state. */
export function VariablesList({
  query,
  onCreate,
  ...handlers
}: VariableHandlers & {
  readonly query: ReturnType<typeof useQuery<EnvironmentVariableView[]>>;
  readonly onCreate: () => void;
}) {
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data == null) {
    return <ListSkeleton />;
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={KeyRoundIcon}
        title="Nenhuma variável ainda"
        description="Adicione configurações como NODE_ENV ou secrets como DATABASE_URL."
        action={
          handlers.canEdit ? (
            <Button size="sm" onClick={onCreate}>
              <PlusIcon aria-hidden />
              Nova variável
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <SearchableVariables variables={query.data} {...handlers} />;
}

function SearchableVariables({
  variables,
  ...handlers
}: VariableHandlers & { readonly variables: readonly EnvironmentVariableView[] }) {
  const [search, setSearch] = useState("");
  const visible = filterVariablesByKey(variables, search);
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
        />
        <Input
          type="search"
          aria-label="Buscar variável pelo nome"
          placeholder="Buscar pelo nome"
          className="pl-9"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <List>
        {visible.length === 0 ? (
          <ListRow>
            <p className="text-sm text-muted-foreground">Nenhuma variável com esse nome.</p>
          </ListRow>
        ) : null}
        {visible.map((variable) => (
          <VariableRow key={variable.id} variable={variable} {...handlers} />
        ))}
      </List>
    </div>
  );
}
