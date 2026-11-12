import { open } from "node:fs/promises";

import { BackupTooLargeError } from "./backup.errors";

/** Reads an immutable local snapshot after validating its descriptor's actual size. */
export async function readBackupFile(
  file: Bun.BunFile,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    Number.isSafeInteger(maxBytes) === false ||
    maxBytes < 1 ||
    maxBytes >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(`Invalid backup file limit: ${maxBytes}`);
  }
  const path = file.name;
  if (path == null || path.trim() === "") {
    throw new Error("Backup file requires a local path");
  }
  await using handle = await open(path, "r");
  const metadata = await handle.stat();
  if (Number.isSafeInteger(metadata.size) === false || metadata.size < 0) {
    throw new RangeError(`Invalid backup file size: ${metadata.size}`);
  }
  if (metadata.size > maxBytes) {
    throw new BackupTooLargeError(metadata.size, maxBytes);
  }
  // Size and contents must come from the same descriptor when the path is replaced.
  const bytes = new Uint8Array(metadata.size);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesRead === 0) {
      throw new Error("Backup file shrank during its snapshot read");
    }

    offset += bytesRead;
  }

  const finalMetadata = await handle.stat();
  if (finalMetadata.size > maxBytes) {
    throw new BackupTooLargeError(finalMetadata.size, maxBytes);
  }

  if (finalMetadata.size !== metadata.size || finalMetadata.mtimeMs !== metadata.mtimeMs) {
    throw new Error("Backup file changed during its snapshot read");
  }

  return bytes;
}

/** Bounds the transfer itself, so changed or untrusted object metadata cannot bypass the limit. */
export async function readBackupBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  expectedBytes?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  await using _reader = { [Symbol.asyncDispose]: async () => await reader.cancel() };
  if (Number.isSafeInteger(maxBytes) === false || maxBytes < 1) {
    throw new RangeError(`Invalid backup read limit: ${maxBytes}`);
  }
  if (
    expectedBytes != null &&
    (Number.isSafeInteger(expectedBytes) === false || expectedBytes < 0 || expectedBytes > maxBytes)
  ) {
    throw new RangeError(`Invalid expected backup size: ${expectedBytes}`);
  }
  let bytes = new Uint8Array(expectedBytes ?? 0);
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    size += next.value.byteLength;
    if (size > maxBytes) {
      throw new BackupTooLargeError(size, maxBytes);
    }
    if (size > bytes.byteLength) {
      const grown = new Uint8Array(Math.min(maxBytes, Math.max(size, bytes.byteLength * 2)));
      grown.set(bytes);
      bytes = grown;
    }
    bytes.set(next.value, size - next.value.byteLength);
  }
  return bytes.subarray(0, size);
}
