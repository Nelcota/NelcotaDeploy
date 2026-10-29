import { z } from "zod";

const MAX_MOUNT_PATH_LENGTH = 200;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
/** System directories a volume would hide or break inside the container. */
const RESERVED_PATHS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
];

/** Most volumes a project can mount. */
export const MAX_VOLUMES_PER_PROJECT = 10;

function isInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

/**
 * Tells whether a path can receive a volume: absolute, without `.` or `..` segments, a
 * trailing slash or unusual characters, and outside the system directories.
 *
 * @param path - Path inside the container.
 * @returns True when the path is allowed.
 */
export function isAllowedMountPath(path: string): boolean {
  if (path.length > MAX_MOUNT_PATH_LENGTH || path.startsWith("/") === false) {
    return false;
  }
  const segments = path.slice(1).split("/");
  const validSegments = segments.every(
    (segment) => SEGMENT_PATTERN.test(segment) && segment !== "." && segment !== "..",
  );
  if (validSegments === false) {
    return false;
  }
  return RESERVED_PATHS.some((reserved) => isInside(path, reserved)) === false;
}

/**
 * Tells whether two mount paths overlap, one inside the other, which would hide files of one
 * volume under the other.
 *
 * @param first - A mount path.
 * @param second - Another mount path.
 * @returns True when they are equal or nested.
 */
export function mountPathsOverlap(first: string, second: string): boolean {
  return isInside(first, second) || isInside(second, first);
}

export const volumeInputSchema = z.object({
  mountPath: z.string().trim().refine(isAllowedMountPath, {
    message: "Use um caminho absoluto, como /app/data, fora das pastas do sistema",
  }),
});

export type VolumeInput = z.infer<typeof volumeInputSchema>;
