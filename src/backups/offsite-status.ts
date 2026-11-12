import { join } from "node:path";

import { z } from "zod";

import { localObjectStore } from "./local-object-store";

const STATUS_FILE = "offsite-status.json";
const UPLOAD_FAILURE = "Offsite backup upload failed";

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
 * @param outcome - The uploaded `key` or a failure marker, and when the attempt ran.
 */
export async function recordOffsiteStatus(
  directory: string,
  outcome:
    | { readonly at: Date; readonly key: string }
    | { readonly at: Date; readonly failed: true },
): Promise<void> {
  const previous = "failed" in outcome ? await readOffsiteStatus(directory) : null;
  const attemptedAt = outcome.at.toISOString();
  const status: OffsiteStatus =
    "key" in outcome
      ? { attemptedAt, uploadedAt: attemptedAt, key: outcome.key, error: null }
      : {
          attemptedAt,
          uploadedAt: previous?.uploadedAt ?? null,
          key: previous?.key ?? null,
          error: UPLOAD_FAILURE,
        };
  const bytes = new TextEncoder().encode(JSON.stringify(status));
  await localObjectStore(directory).write(STATUS_FILE, bytes);
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
  if (parsed.success === false) {
    return null;
  }

  // Older versions persisted raw storage errors. Keep the failure signal without the details.
  return { ...parsed.data, error: parsed.data.error == null ? null : UPLOAD_FAILURE };
}
