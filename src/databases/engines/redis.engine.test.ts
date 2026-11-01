import { describe, expect, test } from "bun:test";

import { redisEngine } from "./redis.engine";

const RESULT = { exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false };

describe("redisEngine.isReady", () => {
  test("accepts a server that answers PONG", () => {
    expect(redisEngine.isReady({ ...RESULT, stdout: "PONG\n" })).toBe(true);
  });

  test("accepts a server that asks for the password", () => {
    expect(redisEngine.isReady({ ...RESULT, stdout: "NOAUTH Authentication required.\n" })).toBe(
      true,
    );
  });

  test("rejects a server that refuses connections", () => {
    const refused = {
      ...RESULT,
      exitCode: 1,
      stderr: "Could not connect to Redis at 127.0.0.1:6379: Connection refused",
    };

    expect(redisEngine.isReady(refused)).toBe(false);
  });
});

describe("redisEngine.containerSettings", () => {
  test("requires the password and keeps an append-only file", () => {
    const settings = redisEngine.containerSettings("secret");

    expect(settings.command).toEqual([
      "redis-server",
      "--appendonly",
      "yes",
      "--requirepass",
      "secret",
    ]);
  });
});
