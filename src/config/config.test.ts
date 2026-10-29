import { describe, expect, test } from "bun:test";

import { InvalidConfigError, parseConfig } from "./config";

describe("parseConfig", () => {
  test("applies defaults and resolves paths to absolute", () => {
    const config = parseConfig({});

    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_PATH.startsWith("/")).toBe(true);
    expect(config.TRAEFIK_ENABLED).toBe(false);
  });

  test("throws InvalidConfigError for an encryption key with the wrong length", () => {
    expect(() =>
      parseConfig({ NELCOTA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow(InvalidConfigError);
  });

  test("throws InvalidConfigError for a short auth secret", () => {
    expect(() => parseConfig({ BETTER_AUTH_SECRET: "short" })).toThrow(InvalidConfigError);
  });

  test("throws InvalidConfigError for an unknown schedule time zone", () => {
    expect(() => parseConfig({ SCHEDULE_TIME_ZONE: "Mars/Olympus" })).toThrow(InvalidConfigError);
  });

  test("treats an empty ACME_EMAIL as not set", () => {
    expect(parseConfig({ ACME_EMAIL: "" }).ACME_EMAIL).toBeUndefined();
  });

  test("throws InvalidConfigError for a malformed ACME_EMAIL", () => {
    expect(() => parseConfig({ ACME_EMAIL: "not-an-email" })).toThrow(InvalidConfigError);
  });

  test("keeps backups next to the database by default", () => {
    const config = parseConfig({ DATABASE_PATH: "/data/nelcota.db" });

    expect(config.BACKUP_DIR).toBe("/data/backups");
    expect(config.BACKUPS_KEPT).toBe(7);
  });

  test("has no backup directory for an in-memory database", () => {
    expect(parseConfig({ DATABASE_PATH: ":memory:" }).BACKUP_DIR).toBeUndefined();
  });

  test("throws InvalidConfigError for BACKUPS_KEPT below 1", () => {
    expect(() => parseConfig({ BACKUPS_KEPT: "0" })).toThrow(InvalidConfigError);
  });

  test("keeps the in-memory database path unchanged", () => {
    expect(parseConfig({ DATABASE_PATH: ":memory:" }).DATABASE_PATH).toBe(":memory:");
  });
});
