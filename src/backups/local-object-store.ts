import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type { ObjectStore } from "./offsite-backup";

/** Resolves a key inside the directory, refusing keys that would climb out of it. */
function pathOf(directory: string, key: string): string {
  const path = resolve(directory, key);
  if (path.startsWith(`${directory}${sep}`) === false) {
    throw new RangeError(`Storage key ${JSON.stringify(key)} is outside the backup directory`);
  }
  return path;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, resolve(entry.parentPath, entry.name)).replaceAll(sep, "/"),
    );
}

/**
 * Keeps objects as files in a directory, for when no bucket is configured. Keys are paths
 * below the directory, with `/` between folders.
 *
 * @param directory - Directory that holds the objects; created on the first write.
 * @returns The store.
 */
export function localObjectStore(directory: string): ObjectStore {
  const root = resolve(directory);
  return {
    write: async (key, data) => {
      const path = pathOf(root, key);
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, data);
    },
    list: async (prefix) => (await listFiles(root)).filter((key) => key.startsWith(prefix)),
    delete: async (key) => {
      await rm(pathOf(root, key), { force: true });
    },
    read: async (key) => await Bun.file(pathOf(root, key)).bytes(),
  };
}
