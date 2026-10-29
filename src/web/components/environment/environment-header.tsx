import { PlusIcon } from "lucide-react";

import type { EnvironmentVariableView } from "@/environments";
import { EnvImportDialog } from "@/web/components/forms/env-import-dialog";
import { TabHeader } from "@/web/components/projects/project-header";
import { Button } from "@/web/components/ui/button";

import { describeKinds } from "./variable-draft";

/** Title, variable counts and, for editors, the import and create buttons. */
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
  return (
    <TabHeader
      title="Variáveis"
      count={variables?.length ?? null}
      description={
        <>
          Configurações e secrets entregues ao contêiner. As mudanças valem no próximo deploy
          {variables == null ? "." : ` · ${describeKinds(variables)}.`}
        </>
      }
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
