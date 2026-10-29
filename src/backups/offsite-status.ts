import { join } from "node:path";

import { z } from "zod";

const STATUS_FILE = "offsite-status.json";
const MAX_ERROR_LENGTH = 300;

const statusSchema = z.object({
  attemptedAt: z.iso.datetime(),
  uploadedAt: z.iso.datetime().nullable(),
  key: z.string().nullable(),
  error: z.string().nullable(),
});

/** Outcome of the latest off-site upload, kept next to the local backups. */
export type OffsiteStatus = z.infer<typeof statusSchema>;

/**
 * Records the outcome of an off-site upload. A failure keeps the time of the last success.
 *
 * @param directory - Local backup directory.
 * @param outcome - The uploaded `key`, or the `error` of a failed upload, and when it ran.
 */
export async function recordOffsiteStatus(
  directory: string,
  outcome:
    | { readonly at: Date; readonly key: string }
    | { readonly at: Date; readonly error: string },
): Promise<void> {
  const previous = await readOffsiteStatus(directory);
  const attemptedAt = outcome.at.toISOString();
  const status: OffsiteStatus =
    "key" in outcome
      ? { attemptedAt, uploadedAt: attemptedAt, key: outcome.key, error: null }
      : {
          attemptedAt,
          uploadedAt: previous?.uploadedAt ?? null,
          key: previous?.key ?? null,
          error: outcome.error.slice(0, MAX_ERROR_LENGTH),
        };
  await Bun.write(join(directory, STATUS_FILE), JSON.stringify(status));
}

/**
 * Reads the outcome of the latest off-site upload.
 *
 * @param directory - Local backup directory.
 * @returns The status, or null when nothing was uploaded yet or the file is unreadable.
 */
export async function readOffsiteStatus(directory: string): Promise<OffsiteStatus | null> {
  const file = Bun.file(join(directory, STATUS_FILE));
  if ((await file.exists()) === false) {
    return null;
  }
  // A damaged file only means the status is unknown; the next upload writes a new one.
  const parsed = statusSchema.safeParse(await file.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}
