import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { compressClientAssets } from "./compressed-assets";
import { acceptsGzip } from "./content-encoding";
import { serveStaticAsset } from "./static-response";

test.each(["gzip", "br, gzip;q=0.5", "*", "GZIP ; q=1", "gzip;q=0.001"])(
  "accepts gzip negotiated by %p",
  (header) => {
    expect(acceptsGzip(header)).toBe(true);
  },
);

test.each([
  null,
  "",
  "identity",
  "gzip;q=0, *;q=1",
  "gzip;q=NaN",
  "gzip;q=",
  "gzip;q=2",
  "gzip;q=.5",
  "gzip;q=1;q=0",
])("refuses gzip for %p", (header) => {
  expect(acceptsGzip(header)).toBe(false);
});

test("serves compressed and identity assets with correct MIME, cache, length and HEAD headers", async () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, "nelcota-static-"));
  await using _directory = {
    [Symbol.asyncDispose]: async () => {
      if (resolve(directory).startsWith(`${temporaryRoot}${sep}`) === false) {
        throw new Error("Unexpected static fixture directory");
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
  await mkdir(join(directory, "assets"));
  const content = "console.log('compressed asset');\n".repeat(100);
  await Bun.write(join(directory, "assets", "app.js"), content);
  await compressClientAssets(directory);
  const response = await serveStaticAsset(
    new Request("http://local/assets/app.js", { headers: { "Accept-Encoding": "gzip" } }),
    directory,
  );
  expect(response?.headers.get("Content-Encoding")).toBe("gzip");
  expect(response?.headers.get("Content-Type")).toContain("javascript");
  expect(response?.headers.get("Vary")).toBe("Accept-Encoding");
  expect(response?.headers.get("Cache-Control")).toContain("immutable");
  const compressed = await response?.bytes();
  if (compressed == null) {
    throw new Error("Compressed response missing");
  }
  expect(new TextDecoder().decode(Bun.gunzipSync(compressed))).toBe(content);
  const identity = await serveStaticAsset(
    new Request("http://local/assets/app.js", { headers: { "Accept-Encoding": "gzip;q=0, *" } }),
    directory,
  );
  expect(identity?.headers.has("Content-Encoding")).toBe(false);
  expect(await identity?.text()).toBe(content);
  const head = await serveStaticAsset(
    new Request("http://local/assets/app.js", {
      method: "HEAD",
      headers: { "Accept-Encoding": "gzip" },
    }),
    directory,
  );
  expect(head?.body).toBeNull();
  expect(head?.headers.get("Content-Length")).toBe(String(compressed.byteLength));
  expect(await serveStaticAsset(new Request("http://local/%xx"), directory)).toBeNull();
  expect(await serveStaticAsset(new Request("http://local/..%5coutside.js"), directory)).toBeNull();
});
