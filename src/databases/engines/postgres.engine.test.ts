import { describe, expect, test } from "bun:test";

import { postgresEngine } from "./postgres.engine";

describe("postgresEngine.connectionUrl", () => {
  test("points to the app database on the given host", () => {
    const url = postgresEngine.connectionUrl("nelcota-db-0a1b2c3d4e5f", "abc123");

    expect(url).toBe("postgresql://app:abc123@nelcota-db-0a1b2c3d4e5f:5432/app");
  });

  test("encodes characters of the password that have a meaning in URLs", () => {
    const url = postgresEngine.connectionUrl("db", "p@ss/word");

    expect(url).toBe("postgresql://app:p%40ss%2Fword@db:5432/app");
  });
});

describe("postgresEngine.containerSettings", () => {
  test("passes the password through the environment, never the command", () => {
    const settings = postgresEngine.containerSettings("secret");

    expect(settings.environment["POSTGRES_PASSWORD"]).toBe("secret");
    expect(settings.command).toEqual([]);
  });
});
