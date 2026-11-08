import { EnvImportDialog } from "@/web/components/forms/env-import/env-import-dialog";
import { ErrorState, ListSkeleton } from "@/web/components/layout/states";
import { TabHeader } from "@/web/components/projects/project-header";
import { useCan } from "@/web/components/shell/use-permissions";

import { useEnvironmentVariables } from "../use-environment-variables";
import { RepositoryEnvironment } from "./repository-environment";

/** Imports variables from one source without mixing discovery into the saved variable list. */
export function EnvironmentImportPage({
  projectId,
  source,
}: {
  readonly projectId: string;
  readonly source: "file" | "repository";
}) {
  const can = useCan();
  if (can("environment:write") === false) {
    return <p role="alert">Você não tem permissão para importar variáveis.</p>;
  }
  return <ImportContent projectId={projectId} source={source} />;
}

function ImportContent({
  projectId,
  source,
}: {
  readonly projectId: string;
  readonly source: "file" | "repository";
}) {
  const { variables, refreshPendingChanges } = useEnvironmentVariables(projectId);
  if (variables.isError) {
    return <ErrorState error={variables.error} onRetry={() => void variables.refetch()} />;
  }
  if (variables.data == null) {
    return <ListSkeleton rows={2} />;
  }
  return (
    <>
      <TabHeader
        title={
          source === "file"
            ? "Importar variáveis de arquivo .env"
            : "Importar variáveis do repositório"
        }
      />
      {source === "file" ? (
        <div className="space-y-4 rounded-2xl bg-card p-5 ring-1 ring-border/70">
          <p className="text-sm text-muted-foreground">
            Carregue ou cole um arquivo .env e revise as inclusões e substituições antes de
            importar.
          </p>
          <EnvImportDialog
            projectId={projectId}
            variables={variables.data}
            onImported={refreshPendingChanges}
          />
        </div>
      ) : (
        <RepositoryEnvironment projectId={projectId} variables={variables.data} />
      )}
    </>
  );
}
