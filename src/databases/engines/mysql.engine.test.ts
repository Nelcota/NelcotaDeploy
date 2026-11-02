import { describe, expect, test } from "bun:test";

import { mysqlEngine } from "./mysql.engine";

const RESULT = { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };
const DUMP_PATH = "/tmp/nelcota-0a1b.dump";

describe("mysqlEngine.connectionUrl", () => {
  test("points to the app database on the given host", () => {
    const url = mysqlEngine.connectionUrl("nelcota-db-0a1b2c3d4e5f", "abc123");

    expect(url).toBe("mysql://app:abc123@nelcota-db-0a1b2c3d4e5f:3306/app");
  });

  test("encodes characters of the password that have a meaning in URLs", () => {
    const url = mysqlEngine.connectionUrl("db", "p@ss/word");

    expect(url).toBe("mysql://app:p%40ss%2Fword@db:3306/app");
  });
});

describe("mysqlEngine.containerSettings", () => {
  test("passes the passwords through the environment, never the command", () => {
    const settings = mysqlEngine.containerSettings("secret");

    expect(settings.environment).toMatchObject({
      MYSQL_DATABASE: "app",
      MYSQL_USER: "app",
      MYSQL_PASSWORD: "secret",
      MYSQL_ROOT_PASSWORD: "secret",
    });
    expect(settings.command).toEqual([]);
  });
});

describe("mysqlEngine.isReady", () => {
  test("accepts a server whose ping succeeds", () => {
    expect(mysqlEngine.isReady(RESULT)).toBe(true);
  });

  test("rejects a server that refuses connections", () => {
    expect(mysqlEngine.isReady({ ...RESULT, exitCode: 1 })).toBe(false);
  });
});

describe("mysqlEngine.backup", () => {
  test("passes the dump path as an argument of the script, never inside it", () => {
    const dump = mysqlEngine.backup?.dump(DUMP_PATH) ?? [];

    expect(dump.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(dump.at(-1)).toBe(DUMP_PATH);
    expect(dump[2]).not.toContain(DUMP_PATH);
  });

  test("dumps the app database with the statements that recreate it", () => {
    const script = mysqlEngine.backup?.dump(DUMP_PATH)[2] ?? "";

    expect(script).toContain("--databases app");
    expect(script).toContain("--add-drop-database");
    expect(script).toContain("--single-transaction");
  });

  test("restores from the path given as an argument", () => {
    const restore = mysqlEngine.backup?.restore(DUMP_PATH) ?? [];

    expect(restore.at(-1)).toBe(DUMP_PATH);
    expect(restore[2]).toContain('< "$1"');
  });

  test("never puts the password in the command", () => {
    const commands = [
      ...(mysqlEngine.backup?.dump(DUMP_PATH) ?? []),
      ...(mysqlEngine.backup?.restore(DUMP_PATH) ?? []),
    ];

    expect(commands.join(" ")).not.toContain("secret");
    expect(commands.join(" ")).toContain('"$MYSQL_ROOT_PASSWORD"');
  });
});
