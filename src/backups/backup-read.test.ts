import { expect, test } from "bun:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { readBackupBytes } from "./backup-read";
import { BackupTooLargeError } from "./backup.errors";
import { localObjectStore } from "./local-object-store";

test("replaces local objects atomically and refuses oversized local snapshots", async () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, "nelcota-snapshot-"));
  await using _directory = {
    [Symbol.asyncDispose]: async () => {
      if (resolve(directory).startsWith(`${temporaryRoot}${sep}`) === false) {
        throw new Error("Unexpected backup fixture directory");
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
  const store = localObjectStore(directory);
  await store.write("object", new Uint8Array([1, 2, 3]));
  await using previous = await open(join(directory, "object"), "r");
  const replacement: unknown = await store
    .write("object", new Uint8Array([4, 5, 6]))
    .catch((error: unknown) => error);
  expect(await Bun.file(previous.fd).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  if (replacement != null) {
    // Windows may refuse replacing a file held without delete sharing; the old object must survive.
    expect(process.platform).toBe("win32");
    expect(replacement).toMatchObject({ code: "EPERM" });
    expect(await store.read("object", 3)).toEqual(new Uint8Array([1, 2, 3]));
  }
  await previous.close();
  if (replacement != null) {
    await store.write("object", new Uint8Array([4, 5, 6]));
  }
  expect(await store.read("object", 3)).toEqual(new Uint8Array([4, 5, 6]));
  const error: unknown = await store.read("object", 2).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(BackupTooLargeError);
});

test("reads a backup at its limit without changing the bytes", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
    },
  });
  expect(await readBackupBytes(stream, 3)).toEqual(new Uint8Array([1, 2, 3]));
});

test("cancels an oversized transfer before collecting further chunks", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  const error: unknown = await readBackupBytes(stream, 3).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(BackupTooLargeError);
  expect(cancelled).toBe(true);
});

test("grows a stale size hint while enforcing the actual transferred byte limit", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.enqueue(new Uint8Array([2, 3]));
      controller.close();
    },
  });
  expect(await readBackupBytes(stream, 3, 1)).toEqual(new Uint8Array([1, 2, 3]));
});

test.each([0, -1, NaN, Infinity, 1.5])("rejects an invalid backup limit %p", async (limit) => {
  const error: unknown = await readBackupBytes(new ReadableStream(), limit).catch(
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(RangeError);
});
