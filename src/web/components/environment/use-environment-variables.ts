import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAction } from "@/web/components/layout/use-action";
import {
  deleteEnvironmentVariableFn,
  listEnvironmentVariablesFn,
} from "@/web/functions/environment.functions";

/** Loads a project's variables and deletes them, refreshing the pending-changes banner. */
export function useEnvironmentVariables(projectId: string) {
  const variables = useQuery({
    queryKey: ["environment", projectId],
    queryFn: () => listEnvironmentVariablesFn({ data: { projectId } }),
  });
  const queryClient = useQueryClient();
  // The server compares the variables with what the live container got; refresh that answer.
  const refreshPendingChanges = () => {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  };
  const remove = useAction({
    action: (variableId: string) =>
      deleteEnvironmentVariableFn({ data: { projectId, variableId } }),
    successMessage: "Variável excluída",
    invalidate: [["environment", projectId]],
    onSuccess: refreshPendingChanges,
  });
  return { variables, remove, refreshPendingChanges };
}
