import { expect, test } from "bun:test";

import { type CommandRunner, runProcess } from "@/process";

import { runContainerExec } from "./docker-exec";
import { EXEC_SCRIPT, STOP_EXEC_SCRIPT } from "./docker-exec-scripts";

const COMMAND_TIMEOUT_IN_MS = 15_000;
const TASK_TIMEOUT_IN_MS = 1_500;

async function startExecFixture() {
  const name = `nelcota-exec-audit-${Bun.randomUUIDv7()}`;
  const start = await runProcess(
    [
      "docker",
      "run",
      "--detach",
      "--rm",
      "--user",
      "65534:65534",
      "--name",
      name,
      "alpine:3.24",
      "sleep",
      "60",
    ],
    { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
  );
  expect(start.exitCode).toBe(0);
  return {
    name,
    [Symbol.asyncDispose]: async () => {
      const result = await runProcess(["docker", "rm", "--force", name], {
        timeoutInMs: COMMAND_TIMEOUT_IN_MS,
      });
      expect(result.exitCode).toBe(0);
    },
  };
}

test(
  "stops descendants on a Docker kernel without the children proc file",
  async () => {
    await using container = await startExecFixture();

    const fallback = STOP_EXEC_SCRIPT.replace(
      'if [ -r /proc/"$1"/task/"$1"/children ]; then',
      "if false; then",
    );
    expect(fallback).not.toBe(STOP_EXEC_SCRIPT);
    const runner: CommandRunner = async (command, options) => {
      const script = command.indexOf(STOP_EXEC_SCRIPT);
      if (script >= 0) {
        return await runProcess(command.with(script, fallback), options);
      }

      expect(command).toContain(EXEC_SCRIPT);
      return await runProcess(command, options);
    };

    const result = await runContainerExec(
      runner,
      {
        binary: "docker",
        containerId: container.name,
        command: [
          "sh",
          "-c",
          '[ "$(id -u)" = 65534 ] || exit 91; sleep 40 & printf "%s\\n" "$!"; wait',
        ],
      },
      { timeoutInMs: TASK_TIMEOUT_IN_MS },
    );

    const child = result.stdout.trim();
    expect(child).toMatch(/^\d+$/);
    expect(result.timedOut).toBe(true);
    const verification = await runProcess(
      [
        "docker",
        "exec",
        container.name,
        "sh",
        "-c",
        'if [ -r "/proc/$1/stat" ]; then read -r stat < "/proc/$1/stat"; fields=${stat##*) }; set -- $fields; [ "$1" = Z ]; fi',
        "sh",
        child,
      ],
      { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
    );
    expect(verification.exitCode).toBe(0);
  },
  COMMAND_TIMEOUT_IN_MS * 3,
);

test.each(["STOP", "KILL"] as const)(
  "resumes processes it paused when a descendant rejects %s",
  async (signal) => {
    await using container = await startExecFixture();
    const controller = new AbortController();
    const task = { root: "", child: "" };
    const stopWithDeniedSignal = `
root_for_test=$1
kill() {
  if [ "$2" = "${signal}" ] && [ "$3" != "$root_for_test" ]; then
    printf 'Test signal denied\\n' >&2
    return 1
  fi
  command kill "$@"
}
${STOP_EXEC_SCRIPT}`;
    const runner: CommandRunner = async (command, options) => {
      const script = command.indexOf(STOP_EXEC_SCRIPT);
      if (script >= 0) {
        task.root = command.at(-2) ?? "";
        return await runProcess(command.with(script, stopWithDeniedSignal), options);
      }

      return await runProcess(command, options);
    };

    const termination = runContainerExec(
      runner,
      {
        binary: "docker",
        containerId: container.name,
        command: ["sh", "-c", 'sleep 40 & printf "%s\\n" "$!"; wait'],
      },
      {
        timeoutInMs: COMMAND_TIMEOUT_IN_MS,
        onLine: (line, stream) => {
          if (stream === "stdout") {
            task.child = line;
            controller.abort();
          }
        },
        signal: controller.signal,
      },
    );
    const failure = await termination.catch((error: unknown) => error);
    if (failure instanceof Error === false || failure.cause instanceof Error === false) {
      throw new Error("Expected a termination error with a cause");
    }

    expect(failure.cause.message).toContain("Test signal denied");
    expect(task.root).toMatch(/^\d+$/);
    expect(task.child).toMatch(/^\d+$/);

    const verification = await runProcess(
      [
        "docker",
        "exec",
        container.name,
        "sh",
        "-c",
        `set -f
for pid in "$@"; do
  IFS= read -r stat < "/proc/$pid/stat" || exit 1
  fields=\${stat##*) }
  set -- $fields
  case "$1" in T|t|Z) exit 1;; esac
done`,
        "sh",
        task.root,
        task.child,
      ],
      { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
    );
    expect(verification.exitCode).toBe(0);
  },
  COMMAND_TIMEOUT_IN_MS * 3,
);
