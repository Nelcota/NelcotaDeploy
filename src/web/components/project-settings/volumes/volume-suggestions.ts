import { isAllowedMountPath, mountPathsOverlap } from "@/shared/schemas/volume.schema";

/** Excludes every existing path, including detached/deleting volumes, without hiding ambiguous candidates. */
export function availableVolumePaths(
  paths: readonly string[],
  volumes: readonly { readonly mountPath: string }[],
): string[] {
  return [...new Set(paths)]
    .filter(
      (path) =>
        isAllowedMountPath(path) &&
        volumes.some((volume) => mountPathsOverlap(path, volume.mountPath)) === false,
    )
    .toSorted();
}
