import { ENCRYPTED_FILE_OVERHEAD_BYTES } from "@/secrets";

export const MAX_BACKUP_BYTES = 536_870_912;
export const MAX_ENCRYPTED_BACKUP_BYTES = MAX_BACKUP_BYTES + ENCRYPTED_FILE_OVERHEAD_BYTES;

let memoryTail = Promise.resolve();

/** Serializes memory-heavy backup phases in this process, including panel backups. */
export async function acquireBackupMemory(signal?: AbortSignal): Promise<Disposable> {
  signal?.throwIfAborted();
  const previous = memoryTail;
  const released = Promise.withResolvers<void>();
  memoryTail = previous.then(async () => await released.promise);
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(new Error("Backup memory reservation cancelled"));
  signal?.addEventListener("abort", onAbort, { once: true });
  using _listener = { [Symbol.dispose]: () => signal?.removeEventListener("abort", onAbort) };
  try {
    await Promise.race([previous, aborted.promise]);
    signal?.throwIfAborted();
  } catch (error) {
    // A cancelled waiter must not let its successor overtake the current owner.
    void previous.then(() => released.resolve());
    throw error;
  }
  return { [Symbol.dispose]: () => released.resolve() };
}
