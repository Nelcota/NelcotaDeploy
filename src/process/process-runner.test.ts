import { describe, expect, test } from "bun:test";

import { buildChildEnvironment, runProcess } from "./process-runner";

describe("runProcess", () => {
  test("returns exit code and streams each output line", async () => {
    const lines: string[] = [];

    const result = await runProcess(["bun", "-e", "console.log('a'); console.error('b')"], {
      timeoutInMs: 10_000,
      onLine: (line, stream) => lines.push(`${stream}:${line}`),
    });

    expect(result.exitCode).toBe(0);
    expect(lines.toSorted()).toEqual(["stderr:b", "stdout:a"]);
  });

  test("passes arguments literally without shell interpretation", async () => {
    const result = await runProcess(["echo", "$(id) ; rm -rf / | cat"], { timeoutInMs: 5000 });

    expect(result.stdout).toBe("$(id) ; rm -rf / | cat\n");
  });

  test("reports a timeout when the process exceeds its limit", async () => {
    const result = await runProcess(["sleep", "5"], { timeoutInMs: 200 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  test("reports an abort when the signal fires", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = await runProcess(["sleep", "5"], {
      timeoutInMs: 10_000,
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("buildChildEnvironment", () => {
  test("does not leak platform secrets to child processes", () => {
    process.env["NELCOTA_ENCRYPTION_KEY"] = "should-not-leak";

    const environment = buildChildEnvironment({ EXTRA: "1" });

    expect(environment["NELCOTA_ENCRYPTION_KEY"]).toBeUndefined();
    expect(environment["EXTRA"]).toBe("1");
    delete process.env["NELCOTA_ENCRYPTION_KEY"];
  });
});
