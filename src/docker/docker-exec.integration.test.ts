import { expect, test } from "bun:test";

import { type CommandRunner, runProcess } from "@/process";

import { runContainerExec } from "./docker-exec";
import { EXEC_SCRIPT, STOP_EXEC_SCRIPT } from "./docker-exec-scripts";

const COMMAND_TIMEOUT_IN_MS = 15_000;
const TASK_TIMEOUT_IN_MS = 1_500;

test(
  "stops descendants on a Docker kernel without the children proc file",
  async () => {
    const container = `nelcota-exec-audit-${Bun.randomUUIDv7()}`;
    const start = await runProcess(
      [
        "docker",
        "run",
        "--detach",
        "--rm",
        "--user",
        "65534:65534",
        "--name",
        container,
        "alpine:3.24",
        "sleep",
        "60",
      ],
      { timeoutInMs: COMMAND_TIMEOUT_IN_MS },
    );
    expect(start.exitCode).toBe(0);
    await using _container = {
      [Symbol.asyncDispose]: async () => {
        const result = await runProcess(["docker", "rm", "--force", container], {
          timeoutInMs: COMMAND_TIMEOUT_IN_MS,
        });
        expect(result.exitCode).toBe(0);
      },
    };

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
        containerId: container,
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
        container,
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
