import { expect, test } from "bun:test";

import { getConfig } from "@/config";

import { BackupTooLargeError } from "./backup.errors";
import { offsiteStoreFromConfig } from "./offsite-backup";

test("bounds real S3 client reads before download and rejects growth beyond metadata", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(request.method);
      const changed = new URL(request.url).pathname.endsWith("changed");
      const content = new Uint8Array([1, 2, 3, 4]);
      return new Response(request.method === "HEAD" ? null : content, {
        headers: {
          "Content-Length": String(changed && request.method === "HEAD" ? 2 : content.byteLength),
          "Content-Type": "application/octet-stream",
          ETag: '"fixture"',
          "Last-Modified": "Fri, 06 Nov 2026 12:00:00 GMT",
        },
      });
    },
  });
  await using _server = { [Symbol.asyncDispose]: async () => await server.stop(true) };
  const store = offsiteStoreFromConfig({
    ...getConfig(),
    BACKUP_S3_BUCKET: "test",
    BACKUP_S3_ENDPOINT: server.url.href,
    BACKUP_S3_REGION: "us-east-1",
    BACKUP_S3_ACCESS_KEY_ID: "test",
    BACKUP_S3_SECRET_ACCESS_KEY: "test",
  });
  if (store == null) {
    throw new Error("S3 test store did not initialize");
  }
  const tooLarge: unknown = await store.read("large", 3).catch((error: unknown) => error);
  expect(tooLarge).toBeInstanceOf(BackupTooLargeError);
  expect(requests).toEqual(["HEAD"]);
  expect(await store.read("exact", 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
  const changed: unknown = await store.read("changed", 3).catch((error: unknown) => error);
  expect(changed).toBeInstanceOf(BackupTooLargeError);
});
