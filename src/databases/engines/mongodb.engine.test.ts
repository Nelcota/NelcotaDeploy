import { describe, expect, test } from "bun:test";

import { mongodbEngine } from "./mongodb.engine";

const RESULT = { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };
const ARCHIVE_PATH = "/tmp/nelcota-0a1b.dump";

describe("mongodbEngine.connectionUrl", () => {
  test("points to the app database and authenticates against admin", () => {
    const url = mongodbEngine.connectionUrl("nelcota-db-0a1b2c3d4e5f", "abc123");

    expect(url).toBe("mongodb://app:abc123@nelcota-db-0a1b2c3d4e5f:27017/app?authSource=admin");
  });

  test("encodes characters of the password that have a meaning in URLs", () => {
    const url = mongodbEngine.connectionUrl("db", "p@ss/word");

    expect(url).toBe("mongodb://app:p%40ss%2Fword@db:27017/app?authSource=admin");
  });
});

describe("mongodbEngine.containerSettings", () => {
  test("passes the password through the environment, never the command", () => {
    const settings = mongodbEngine.containerSettings("secret");

    expect(settings.environment).toMatchObject({
      MONGO_INITDB_ROOT_USERNAME: "app",
      MONGO_INITDB_ROOT_PASSWORD: "secret",
    });
    expect(settings.command).toEqual([]);
  });
});

describe("mongodbEngine.isReady", () => {
  test("accepts a server that answers the ping", () => {
    expect(mongodbEngine.isReady({ ...RESULT, stdout: "1\n" })).toBe(true);
  });

  test("rejects a server that cannot be reached", () => {
    const refused = { ...RESULT, exitCode: 1, stderr: "MongoNetworkError: connect ECONNREFUSED" };

    expect(mongodbEngine.isReady(refused)).toBe(false);
  });

  test("rejects an answer other than a successful ping", () => {
    expect(mongodbEngine.isReady({ ...RESULT, stdout: "0\n" })).toBe(false);
  });

  test("checks through the container's own address, not the initialization server", () => {
    expect(mongodbEngine.readinessCommand.join(" ")).toContain('--host "$HOSTNAME"');
  });
});

describe("mongodbEngine.backup", () => {
  test("passes the archive path as an argument of the script, never inside it", () => {
    const dump = mongodbEngine.backup?.dump(ARCHIVE_PATH) ?? [];

    expect(dump.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(dump.at(-1)).toBe(ARCHIVE_PATH);
    expect(dump[2]).not.toContain(ARCHIVE_PATH);
  });

  test("restores by replacing each collection from the archive", () => {
    const script = mongodbEngine.backup?.restore(ARCHIVE_PATH).commands.at(0)?.[2] ?? "";

    expect(script).toContain("mongorestore");
    expect(script).toContain("--drop");
    expect(script).toContain('--archive="$1"');
  });

  test("reads the credentials from the container's environment", () => {
    const script = mongodbEngine.backup?.dump(ARCHIVE_PATH)[2] ?? "";

    expect(script).toContain('--password="$MONGO_INITDB_ROOT_PASSWORD"');
    expect(script).toContain("--authenticationDatabase=admin");
  });
});
