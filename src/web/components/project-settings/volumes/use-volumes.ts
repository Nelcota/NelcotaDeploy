import { useQuery } from "@tanstack/react-query";

import { useAction } from "@/web/components/layout/use-action";
import {
  addVolumeFn,
  deleteVolumeDataFn,
  listVolumesFn,
  setVolumeAttachedFn,
} from "@/web/functions/volumes/volumes.functions";

// While data is being deleted the list refreshes, so the row goes away on its own.
const DELETION_REFRESH_IN_MS = 3000;

/** A project's volumes and the actions that change them. */
export function useVolumes(projectId: string) {
  const volumes = useQuery({
    queryKey: ["volumes", projectId],
    queryFn: () => listVolumesFn({ data: { projectId } }),
    refetchInterval: (query) =>
      query.state.data?.some((volume) => volume.deletionRequestedAt != null) === true
        ? DELETION_REFRESH_IN_MS
        : false,
  });
  const invalidate = [["volumes", projectId], ["project", projectId], ["deployments"]] as const;
  const add = useAction({
    action: (mountPath: string) => addVolumeFn({ data: { projectId, volume: { mountPath } } }),
    successMessage: "Volume adicionado",
    invalidate,
  });
  const toggle = useAction({
    action: (change: { readonly volumeId: string; readonly attached: boolean }) =>
      setVolumeAttachedFn({ data: { projectId, ...change } }),
    successMessage: (_result) => "Volume atualizado",
    invalidate,
  });
  const deleteData = useAction({
    action: (volumeId: string) => deleteVolumeDataFn({ data: { projectId, volumeId } }),
    successMessage: "Os dados serão apagados em instantes",
    invalidate,
  });
  return { volumes, add, toggle, deleteData };
}
