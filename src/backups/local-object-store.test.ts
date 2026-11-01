import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { localObjectStore } from "./local-object-store";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "nelcota-store-"));
  return {
    store: localObjectStore(directory),
    [Symbol.asyncDispose]: async () => await rm(directory, { recursive: true, force: true }),
  };
}

describe("localObjectStore", () => {
  test("reads back what it wrote in nested folders", async () => {
    await using context = await setup();

    await context.store.write("databases/db-1/b-1.dump.enc", new Uint8Array([1, 2, 3]));

    expect([...(await context.store.read("databases/db-1/b-1.dump.enc"))]).toEqual([1, 2, 3]);
  });

  test("lists only the keys under a prefix", async () => {
    await using context = await setup();
    await context.store.write("databases/db-1/b-1.dump.enc", new Uint8Array([1]));
    await context.store.write("databases/db-2/b-2.dump.enc", new Uint8Array([2]));

    const keys = await context.store.list("databases/db-1/");

    expect(keys).toEqual(["databases/db-1/b-1.dump.enc"]);
  });

  test("lists nothing before the first write", async () => {
    await using context = await setup();

    expect(await context.store.list("databases/")).toEqual([]);
  });

  test("deletes an object", async () => {
    await using context = await setup();
    await context.store.write("databases/db-1/b-1.dump.enc", new Uint8Array([1]));

    await context.store.delete("databases/db-1/b-1.dump.enc");

    expect(await context.store.list("databases/")).toEqual([]);
  });

  test("throws RangeError for a key that climbs out of the directory", async () => {
    await using context = await setup();

    const error = await context.store
      .write("../escape.txt", new Uint8Array([1]))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RangeError);
  });
});
