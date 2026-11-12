import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import type { ClientChannel } from "ssh2";

import { assertServerFilePath, RemoteFiles } from "./remote-files";
import { RemoteFileError } from "./remote.errors";

describe("assertServerFilePath", () => {
  test("accepts an absolute path of plain segments", () => {
    expect(assertServerFilePath("/var/lib/nelcota/workspaces/backup-1.dump")).toBe(
      "/var/lib/nelcota/workspaces/backup-1.dump",
    );
  });

  test.each([["relative/file"], ["/var/../etc/passwd"], ["/tmp/a b"], ["/tmp/$(id)"], ["/"]])(
    "throws RemoteFileError for %p",
    (path) => {
      expect(() => assertServerFilePath(path)).toThrow(RemoteFileError);
    },
  );
});

const FILE = "/var/lib/nelcota/workspaces/backup.dump";
const LIMITS = { maxBytes: 4, timeoutInMs: 1000 };
const OPEN_TIMEOUT_IN_MS = 10;

function channelFixture() {
  const stream = new PassThrough({ autoDestroy: false });
  const stderr = new PassThrough({ autoDestroy: false });
  const channel = Object.assign(stream, { stderr }) as unknown as ClientChannel;
  const reading = Promise.withResolvers<void>();
  channel.on("newListener", (event: string | symbol) => {
    if (event === "data") {
      reading.resolve();
    }
  });
  return { channel, reading: reading.promise };
}

describe("RemoteFiles transfer limits", () => {
  test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])(
    "rejects an invalid byte limit of %p before opening SSH",
    async (maxBytes) => {
      let openings = 0;
      const files = new RemoteFiles({
        exec: () => {
          openings += 1;
          return Promise.reject(new Error("Unexpected SSH request"));
        },
      });

      const result = await files
        .read(FILE, { ...LIMITS, maxBytes })
        .catch((error: unknown) => error);

      expect(result).toBeInstanceOf(RemoteFileError);
      expect(openings).toBe(0);
    },
  );

  test("rejects an invalid timer delay before opening SSH", async () => {
    const files = new RemoteFiles({
      exec: () => Promise.reject(new Error("Unexpected SSH request")),
    });

    const result = await files
      .write(FILE, new Uint8Array(0), Number.POSITIVE_INFINITY)
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(RemoteFileError);
  });

  test("times out while opening and destroys a channel that opens late", async () => {
    const opening = Promise.withResolvers<ClientChannel>();
    const { channel } = channelFixture();
    const files = new RemoteFiles({ exec: () => opening.promise });

    const result = await files
      .read(FILE, { ...LIMITS, timeoutInMs: OPEN_TIMEOUT_IN_MS })
      .catch((error: unknown) => error);
    opening.resolve(channel);
    await Promise.resolve();

    expect(result).toHaveProperty(
      "message",
      `File transfer timed out after ${OPEN_TIMEOUT_IN_MS} ms`,
    );
    expect(channel.destroyed).toBe(true);
  });

  test("rejects excess bytes without waiting for the server to acknowledge closure", async () => {
    const { channel, reading } = channelFixture();
    const files = new RemoteFiles({ exec: () => Promise.resolve(channel) });
    const read = files.read(FILE, LIMITS).catch((error: unknown) => error);
    await reading;

    channel.emit("data", Buffer.from("larger"));
    const result = await read;

    expect(result).toHaveProperty("message", `File ${FILE} is larger than 4 bytes`);
    expect(channel.destroyed).toBe(true);
    expect(channel.listenerCount("data")).toBe(0);
  });
});

test("returns all bytes through channel closure, including bytes received after exit", async () => {
  const { channel, reading } = channelFixture();
  const files = new RemoteFiles({ exec: () => Promise.resolve(channel) });
  const read = files.read(FILE, LIMITS);
  await reading;

  channel.emit("data", Buffer.from("ab"));
  channel.emit("exit", 0);
  await Bun.sleep(0);
  channel.emit("data", Buffer.from("cd"));
  channel.emit("close", 0);

  expect(await read).toEqual(Buffer.from("abcd"));
});

test("bounds failure diagnostics and keeps the most recent stderr bytes", async () => {
  const { channel, reading } = channelFixture();
  const files = new RemoteFiles({ exec: () => Promise.resolve(channel) });
  const read = files.read(FILE, LIMITS).catch((error: unknown) => error);
  await reading;

  channel.stderr.emit("data", Buffer.from(`${"a".repeat(10_000)}tail`));
  channel.emit("close", 1);
  const result = await read;

  expect(result).toBeInstanceOf(RemoteFileError);
  expect(result).toHaveProperty("message", `Cannot read ${FILE}: ${"a".repeat(4092)}tail`);
});
