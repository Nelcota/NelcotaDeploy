import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { EnvironmentVariableView } from "@/environments";
import { useAction } from "@/web/components/layout/use-action";
import { useCan } from "@/web/components/shell/use-permissions";
import {
  deleteEnvironmentVariableFn,
  listEnvironmentVariablesFn,
} from "@/web/functions/environment.functions";

import { ApplyVariableChanges } from "./apply-variable-changes";
import { EnvironmentHeader } from "./environment-header";
import { SecretsHelp } from "./secrets-help";
import { VariableDialog } from "./variable-dialog";
import { VariablesList } from "./variables-list";

/** Environment variables of one project: list, search, create, edit, delete and import. */
export function EnvironmentPage({ projectId }: { readonly projectId: string }) {
  const can = useCan();
  const canEdit = can("environment:write");
  const variables = useQuery({
    queryKey: ["environment", projectId],
    queryFn: () => listEnvironmentVariablesFn({ data: { projectId } }),
  });
  const [editing, setEditing] = useState<EnvironmentVariableView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
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
  const openEditor = (variable: EnvironmentVariableView | null) => {
    setEditing(variable);
    setDialogOpen(true);
  };

  return (
    <>
      <EnvironmentHeader
        projectId={projectId}
        variables={variables.data}
        canEdit={canEdit}
        onCreate={() => openEditor(null)}
        onImported={refreshPendingChanges}
      />
      <ApplyVariableChanges projectId={projectId} />
      <VariablesList
        query={variables}
        canEdit={canEdit}
        onCreate={() => openEditor(null)}
        onEdit={openEditor}
        onDelete={(variableId) => remove.mutate(variableId)}
      />
      <SecretsHelp />
      <VariableDialog
        key={editing?.id ?? "new"}
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        variable={editing}
        onSaved={refreshPendingChanges}
      />
    </>
  );
}
