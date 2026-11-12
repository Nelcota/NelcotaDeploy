import { link, open, rm } from "node:fs/promises";

const OWNER_READ_WRITE = 0o600;

/**
 * Publishes a private file only after its contents have been written successfully.
 *
 * @param destination - New file path. Its parent directory must already exist.
 * @param write - Writes the contents to a reserved file on the same filesystem.
 * @throws {Error} When writing or publishing fails, including when the destination exists.
 */
export async function publishPrivateFile(
  destination: string,
  write: (temporaryPath: string) => Promise<void> | void,
): Promise<void> {
  const temporaryPath = `${destination}.${Bun.randomUUIDv7()}.tmp`;
  const reservation = await open(temporaryPath, "wx", OWNER_READ_WRITE);
  await using _temporary = {
    [Symbol.asyncDispose]: async () => await rm(temporaryPath, { force: true }),
  };
  await reservation.close();
  await write(temporaryPath);
  // A same-filesystem hard link publishes the complete file and fails if the name was taken.
  await link(temporaryPath, destination);
}
