import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { EnvironmentImportInput } from "@/shared/schemas/environment/environment-import.schema";
import { toUserMessage } from "@/web/components/layout/error-message";
import { importEnvironmentVariablesFn } from "@/web/functions/environment.functions";

/** Imports the reviewed batch in one request, retaining the input after any failure. */
export function useEnvImport(projectId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    // Imported values may contain secrets; discard unobserved mutations immediately.
    gcTime: 0,
    mutationFn: (input: EnvironmentImportInput) =>
      importEnvironmentVariablesFn({ data: { projectId, input } }),
    onSuccess: ({ savedCount }) => {
      toast.success(
        savedCount === 1 ? "1 variável importada" : `${savedCount} variáveis importadas`,
      );
    },
    onError: (error) => {
      toast.error(
        toUserMessage(
          error,
          "Não foi possível concluir a importação. Confira a lista antes de tentar novamente.",
        ),
      );
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["environment", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
  });
  const importEntries = async (input: EnvironmentImportInput): Promise<boolean> => {
    const imported = await mutation.mutateAsync(input).then(
      () => true,
      () => false,
    );
    mutation.reset();
    return imported;
  };
  return { saving: mutation.isPending, importEntries };
}
