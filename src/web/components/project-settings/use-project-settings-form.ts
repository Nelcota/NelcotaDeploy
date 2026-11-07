import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { toast } from "sonner";

import type { ProjectSettingsFormSection } from "@/shared/schemas/settings/project-settings.schema";
import { projectToFormValues, useProjectForm } from "@/web/components/forms/project-form";
import { toUserMessage } from "@/web/components/layout/error-message";
import { updateProjectSettingsFn } from "@/web/functions/projects.functions";

export type SettingsProject = Parameters<typeof projectToFormValues>[0];

/** Project form filled with the saved values; saving refreshes the project and the list. */
export function useProjectSettingsForm({
  projectId,
  project,
  canEdit,
  section,
}: {
  readonly projectId: string;
  readonly project: SettingsProject;
  readonly canEdit: boolean;
  readonly section: ProjectSettingsFormSection;
}) {
  const queryClient = useQueryClient();
  const editing = useProjectForm({
    projectId,
    canDetect:
      canEdit && (section === "repository" || section === "build" || section === "runtime"),
    initialValues: projectToFormValues(project),
    onSubmit: async (values): Promise<void> => {
      try {
        const saved = await updateProjectSettingsFn({
          data: { projectId, change: { section, project: values } },
        });
        toast.success("Projeto atualizado");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
        editing.form.reset(projectToFormValues(saved));
      } catch (error) {
        toast.error(toUserMessage(error, "Não foi possível salvar."));
      }
    },
  });
  useBlocker({
    shouldBlockFn: () => {
      if (editing.form.state.isSubmitting) {
        toast.info("Aguarde o salvamento antes de sair desta página.");
        return true;
      }
      return (
        editing.form.state.isDefaultValue === false &&
        window.confirm("Descartar as alterações não salvas e sair desta página?") === false
      );
    },
    enableBeforeUnload: () =>
      editing.form.state.isDefaultValue === false || editing.form.state.isSubmitting,
  });
  return editing;
}
