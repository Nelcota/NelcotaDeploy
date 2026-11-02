import { DatabaseIcon } from "lucide-react";

import { ApplyChangesBanner } from "@/web/components/deployments/apply-changes-banner";
import { List, ListRow } from "@/web/components/layout/layout";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";

import { AddDatabaseForm } from "./add-database-form";
import { DatabaseRow } from "./database-row";
import { useDatabases } from "./use-databases";

/** Databases the platform runs for one project: list, create, retry and delete. */
export function DatabasesPage({ projectId }: { readonly projectId: string }) {
  const { databases, create, retry, remove, applyChanges, canEdit, canDelete } =
    useDatabases(projectId);
  if (databases.isError) {
    return <ErrorState error={databases.error} onRetry={() => void databases.refetch()} />;
  }
  const list = databases.data;
  const busy = retry.isPending || remove.isPending;
  return (
    <>
      <TabHeader
        title="Bancos de dados"
        count={list?.length ?? null}
        description="Rodam no servidor do projeto e só aceitam conexões dos contêineres da plataforma. A URL de conexão vira uma variável secreta, que não vai para os previews."
      />
      {applyChanges.showBanner ? (
        <ApplyChangesBanner
          message="Os bancos mudaram. A aplicação só recebe a nova variável quando o contêiner é recriado."
          applying={applyChanges.redeploy.isPending}
          onApply={() => applyChanges.redeploy.mutate()}
        />
      ) : null}
      {list == null ? (
        <ListSkeleton rows={2} />
      ) : (
        <List>
          {canEdit ? (
            <AddDatabaseForm pending={create.isPending} onAdd={(input) => create.mutate(input)} />
          ) : null}
          {list.length === 0 ? (
            <NoDatabasesRow />
          ) : (
            list.map((database) => (
              <DatabaseRow
                key={database.id}
                projectId={projectId}
                database={database}
                canEdit={canEdit}
                canDelete={canDelete}
                busy={busy}
                onRetry={() => retry.mutate(database.id)}
                onDelete={() => remove.mutate(database.id)}
              />
            ))
          )}
        </List>
      )}
    </>
  );
}

function NoDatabasesRow() {
  return (
    <ListRow>
      <DatabaseIcon aria-hidden className="size-4 shrink-0 text-faint" />
      <p className="text-sm text-muted-foreground">
        Nenhum banco de dados ainda. Crie um PostgreSQL, MySQL, MongoDB ou Redis para o projeto.
      </p>
    </ListRow>
  );
}
