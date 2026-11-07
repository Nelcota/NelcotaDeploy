import { expect, test } from "bun:test";

import { detectDatabaseEngine, suggestDatabaseDefaults } from "./database-defaults";

test("uses a unique repository variable that is not yet configured", () => {
  expect(
    suggestDatabaseDefaults({
      engine: "postgres",
      usedKeys: ["DATABASE_URL"],
      templateKeys: ["APP_POSTGRES_URL", "APP_POSTGRES_URL", "REDIS_URL"],
    }),
  ).toEqual({
    environmentKey: "APP_POSTGRES_URL",
    fromTemplate: true,
    candidates: ["APP_POSTGRES_URL"],
  });
});

test("never offers an existing variable or a pending managed database's variable for replacement", () => {
  expect(
    suggestDatabaseDefaults({
      engine: "postgres",
      usedKeys: ["DATABASE_URL", "DATABASE_URL_2", "APP_POSTGRES_URL"],
      templateKeys: ["DATABASE_URL", "APP_POSTGRES_URL"],
    }).environmentKey,
  ).toBe("DATABASE_URL_3");
});

test("keeps ambiguous repository variables as choices instead of selecting one", () => {
  expect(
    suggestDatabaseDefaults({
      engine: "postgres",
      usedKeys: [],
      templateKeys: ["PRIMARY_DATABASE_URL", "AUDIT_POSTGRES_URL"],
    }),
  ).toEqual({
    environmentKey: "DATABASE_URL",
    fromTemplate: false,
    candidates: ["AUDIT_POSTGRES_URL", "PRIMARY_DATABASE_URL"],
  });
});

test("uses independent collision-free Redis names", () => {
  expect(
    suggestDatabaseDefaults({
      engine: "redis",
      usedKeys: ["REDIS_URL"],
      templateKeys: ["DATABASE_URL"],
    }).environmentKey,
  ).toBe("REDIS_URL_2");
  expect(
    suggestDatabaseDefaults({ engine: "redis", usedKeys: [], templateKeys: ["CACHE_REDIS_URL"] })
      .environmentKey,
  ).toBe("CACHE_REDIS_URL");
});

test("does not treat unrelated or unsupported database URLs as supported engine hints", () => {
  expect(
    suggestDatabaseDefaults({
      engine: "postgres",
      usedKeys: [],
      templateKeys: [
        "MONGO_URL",
        "API_URL",
        "REDIS_URL",
        "DATABASE_URL;reboot",
        "DOCKER_POSTGRES_URL",
        `${"A".repeat(129)}_DATABASE_URL`,
      ],
    }).candidates,
  ).toEqual([]);
});

test.each([
  [[], "postgres"],
  [["REDIS_URL"], "redis"],
  [["REDIS_URL", "DATABASE_URL"], "postgres"],
  [["POSTGRES_URL"], "postgres"],
] as const)("detects the initial engine for %p", (templateKeys, expected) => {
  expect(detectDatabaseEngine({ usedKeys: [], templateKeys })).toBe(expected);
});

test("ignores an engine whose required variables are already configured", () => {
  expect(
    detectDatabaseEngine({
      usedKeys: ["DATABASE_URL"],
      templateKeys: ["DATABASE_URL", "REDIS_URL"],
    }),
  ).toBe("redis");
});
