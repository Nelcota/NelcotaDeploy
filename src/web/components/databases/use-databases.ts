import { useQuery } from "@tanstack/react-query";

import type { DatabaseInput } from "@/shared/schemas/database.schema";
import { useApplyChanges } from "@/web/components/deployments/apply-changes-banner";
import { useAction } from "@/web/components/layout/use-action";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { useCan } from "@/web/components/shell/use-permissions";
import {
  createDatabaseFn,
  deleteDatabaseFn,
  listDatabasesFn,
  retryDatabaseFn,
} from "@/web/functions/databases/databases.functions";

// While a database starts, restores or is deleted the list refreshes, so its row follows on its own.
const PENDING_REFRESH_IN_MS = 3000;

/** A project's databases, the actions that change them and the redeploy that applies them. */
export function useDatabases(projectId: string) {
  const can = useCan();
  const databases = useQuery({
    queryKey: ["databases", projectId],
    queryFn: () => listDatabasesFn({ data: { projectId } }),
    refetchInterval: (query) =>
      query.state.data?.some(
        (database) =>
          database.status === "provisioning" ||
          database.status === "restoring" ||
          database.deletionRequestedAt != null,
      ) === true
        ? PENDING_REFRESH_IN_MS
        : false,
  });
  const invalidate = [
    ["databases", projectId],
    ["project", projectId],
    ["environment", projectId],
    ["deployments"],
  ] as const;
  const create = useAction({
    action: (input: DatabaseInput) => createDatabaseFn({ data: { projectId, database: input } }),
    successMessage: "Banco de dados criado. Ele fica pronto em instantes",
    invalidate,
  });
  const retry = useAction({
    action: (databaseId: string) => retryDatabaseFn({ data: { projectId, databaseId } }),
    successMessage: "Iniciando o banco de novo",
    invalidate,
  });
  const remove = useAction({
    action: (databaseId: string) => deleteDatabaseFn({ data: { projectId, databaseId } }),
    successMessage: "O banco e os dados serão apagados em instantes",
    invalidate,
  });
  const applyChanges = useDatabaseChangesApply(projectId);
  return {
    databases,
    create,
    retry,
    remove,
    applyChanges,
    canEdit: can("project:write"),
    canDelete: can("project:delete"),
  };
}

/** The redeploy that hands the application the variables of new or deleted databases. */
function useDatabaseChangesApply(projectId: string) {
  const can = useCan();
  const project = useQuery(projectQueryOptions(projectId));
  const details = project.data;
  // Projects that apply changes on their own queue the redeploy when the change is saved.
  const canRedeploy =
    details?.project.currentDeploymentId != null &&
    details.project.autoApplyChanges === false &&
    can("deployment:create");
  return useApplyChanges(projectId, details?.pendingRuntimeChanges === true, canRedeploy);
}
