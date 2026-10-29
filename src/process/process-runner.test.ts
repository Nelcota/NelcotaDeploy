import { describe, expect, test } from "bun:test";

import { buildChildEnvironment, failureReason, runProcess } from "./process-runner";

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
    const abortDelayInMs = 100;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), abortDelayInMs);

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

describe("failureReason", () => {
  const base = { exitCode: 1, stdout: "", stderr: "", timedOut: false, aborted: false };

  test("reports the last stderr line", () => {
    expect(failureReason({ ...base, stderr: "warning\nError: no space left\n" })).toBe(
      "Error: no space left",
    );
  });

  test("reports a timeout and a cancellation by name", () => {
    expect(failureReason({ ...base, timedOut: true })).toBe("timed out");
    expect(failureReason({ ...base, aborted: true })).toBe("cancelled");
  });

  test("falls back to the exit code when stderr is empty", () => {
    expect(failureReason({ ...base, exitCode: 125 })).toBe("exit code 125");
  });
});
