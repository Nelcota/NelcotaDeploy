import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon, TriangleAlertIcon } from "lucide-react";

import { ConfirmDialog } from "@/web/components/layout/confirm-dialog";
import { useAction } from "@/web/components/layout/use-action";
import { Button } from "@/web/components/ui/button";
import { deleteProjectFn } from "@/web/functions/projects.functions";

import { SettingsSection } from "./settings-section";

/** Deletes the project after the user types its slug. */
export function DangerZone({
  projectId,
  slug,
}: {
  readonly projectId: string;
  readonly slug: string;
}) {
  const navigate = useNavigate();
  const remove = useAction({
    action: () => deleteProjectFn({ data: { projectId } }),
    successMessage: "Projeto em remoção; o worker vai apagar contêineres e imagens",
    invalidate: [["projects"]],
    onSuccess: async () => {
      await navigate({ to: "/projects" });
    },
  });
  return (
    <SettingsSection
      icon={TriangleAlertIcon}
      title={<span className="text-destructive">Zona de perigo</span>}
      description="Ações que não podem ser desfeitas."
    >
      <div className="flex flex-col gap-4 rounded-lg p-4 ring-1 ring-destructive/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Excluir projeto</p>
          <p className="text-sm text-muted-foreground">
            Remove o projeto, seus contêineres, imagens, variáveis, tasks e histórico.
          </p>
        </div>
        <DeleteProjectButton
          slug={slug}
          deleting={remove.isPending}
          onDelete={() => remove.mutate()}
        />
      </div>
    </SettingsSection>
  );
}

function DeleteProjectButton({
  slug,
  deleting,
  onDelete,
}: {
  readonly slug: string;
  readonly deleting: boolean;
  readonly onDelete: () => void;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" className="shrink-0 text-destructive" disabled={deleting}>
          <Trash2Icon aria-hidden />
          Excluir projeto
        </Button>
      }
      title="Excluir este projeto?"
      description="A aplicação sai do ar e todos os dados do projeto são apagados."
      confirmLabel="Excluir definitivamente"
      destructive
      confirmationText={slug}
      onConfirm={onDelete}
    />
  );
}
