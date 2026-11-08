import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";

import type { EnvironmentVariableView } from "@/environments";
import { TabHeader } from "@/web/components/projects/project-header";
import { projectQueryOptions } from "@/web/components/projects/project-query";
import { Button } from "@/web/components/ui/button";

/** Saved variable count and the action for adding one variable. */
export function EnvironmentHeader({
  projectId,
  variables,
  canEdit,
  onCreate,
}: {
  readonly projectId: string;
  readonly variables: readonly EnvironmentVariableView[] | undefined;
  readonly canEdit: boolean;
  readonly onCreate: () => void;
}) {
  const project = useQuery(projectQueryOptions(projectId));
  const description =
    project.data?.project.autoApplyChanges === false
      ? "As mudanças valem no próximo deploy."
      : "Ao salvar, o contêiner é recriado com as mudanças.";
  return (
    <TabHeader
      title="Variáveis de ambiente"
      count={variables?.length ?? null}
      description={description}
      actions={
        canEdit ? (
          <>
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
