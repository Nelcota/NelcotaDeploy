import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Wraps a server function call with a success toast, an error toast and cache
 * invalidation, so every action gives the same feedback.
 *
 * @example
 * const deploy = useAction({
 *   action: () => deployProjectFn({ data: { projectId } }),
 *   successMessage: "Deploy colocado na fila",
 *   invalidate: [["project", projectId]],
 * });
 * deploy.mutate();
 */
export function useAction<TVariables = void, TResult = unknown>(options: {
  readonly action: (variables: TVariables) => Promise<TResult>;
  readonly successMessage?: string | ((result: TResult) => string);
  readonly invalidate?: readonly QueryKey[];
  readonly onSuccess?: (result: TResult) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: options.action,
    onSuccess: async (result) => {
      const message =
        typeof options.successMessage === "function"
          ? options.successMessage(result)
          : options.successMessage;
      if (message != null) {
        toast.success(message);
      }
      // Close dialogs and navigate first; refreshed data follows right after.
      await options.onSuccess?.(result);
      await Promise.all(
        (options.invalidate ?? []).map(
          async (queryKey) => await queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a ação.");
    },
  });
}
