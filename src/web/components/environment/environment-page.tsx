import { useState } from "react";

import type { EnvironmentVariableView } from "@/environments";
import { useCan } from "@/web/components/shell/use-permissions";

import { ApplyVariableChanges } from "./apply-variable-changes";
import { EnvironmentHeader } from "./environment-header";
import { useEnvironmentVariables } from "./use-environment-variables";
import { VariableDialog } from "./variable-dialog/variable-dialog";
import { VariablesList } from "./variables-list";

/** Environment variables of one project: list, search, create, edit, delete and import. */
export function EnvironmentPage({ projectId }: { readonly projectId: string }) {
  const can = useCan();
  const canEdit = can("environment:write");
  const { variables, remove, refreshPendingChanges } = useEnvironmentVariables(projectId);
  const [editing, setEditing] = useState<EnvironmentVariableView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
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
