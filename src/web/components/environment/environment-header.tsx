import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";

import type { EnvironmentVariableView } from "@/environments";
import { EnvImportDialog } from "@/web/components/forms/env-import/env-import-dialog";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";

/** Title, variable count and, for editors, the import and create buttons. */
export function EnvironmentHeader({
  projectId,
  variables,
  canEdit,
  onCreate,
  onImported,
}: {
  readonly projectId: string;
  readonly variables: readonly EnvironmentVariableView[] | undefined;
  readonly canEdit: boolean;
  readonly onCreate: () => void;
  readonly onImported: () => void;
}) {
  const project = useQuery(projectQueryOptions(projectId));
  const description =
    project.data?.project.autoApplyChanges === false
      ? "As mudanças valem no próximo deploy."
      : "Ao salvar, o contêiner é recriado com as mudanças.";
  return (
    <TabHeader
      title="Variáveis"
      count={variables?.length ?? null}
      description={description}
      actions={
        canEdit ? (
          <>
            <EnvImportDialog projectId={projectId} onImported={onImported} />
            <Button onClick={onCreate}>
              <PlusIcon aria-hidden />
              Nova variável
            </Button>
          </>
        ) : null
      }
    />
  );
}
