import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { projectToFormValues, useProjectForm } from "@/web/components/forms/project-form";
import { toUserMessage } from "@/web/components/layout/error-message";
import { updateProjectFn } from "@/web/functions/projects.functions";

export type SettingsProject = Parameters<typeof projectToFormValues>[0];

/** Project form filled with the saved values; saving refreshes the project and the list. */
export function useProjectSettingsForm(projectId: string, project: SettingsProject) {
  const queryClient = useQueryClient();
  return useProjectForm({
    initialValues: projectToFormValues(project),
    onSubmit: async (values) => {
      try {
        await updateProjectFn({ data: { projectId, project: values } });
        toast.success("Projeto atualizado");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
        ]);
      } catch (error) {
        toast.error(toUserMessage(error, "Não foi possível salvar."));
      }
    },
  });
}
